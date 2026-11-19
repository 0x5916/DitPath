package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"morsewell/internal/configs"
	"morsewell/internal/googleauth"
	"morsewell/internal/models"
	"morsewell/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errGooglePasswordRequired = errors.New("linking Google requires a password account")

func (h *GoogleAuthHandler) LinkChallenge(c *gin.Context) {
	var input map[string]json.RawMessage
	if err := bindAuthJSON(c, &input); err != nil || input == nil {
		respondAuthBindingError(c, err)
		return
	}
	user := utils.MustGetUser(c)
	if user.Password == "" {
		h.respondError(c, errGooglePasswordRequired)
		return
	}
	challenge, err := googleauth.NewLinkChallenge(configs.App.JWTSecret, user.ID, time.Now())
	if err != nil {
		h.respondError(c, errGoogleTokenIssue)
		return
	}
	c.JSON(http.StatusOK, gin.H{"challenge": challenge, "nonce": googleauth.LinkNonce(challenge)})
}

func (h *GoogleAuthHandler) Link(c *gin.Context) {
	var input struct {
		Challenge       string `json:"challenge" binding:"required,max=1024"`
		Credential      string `json:"credential" binding:"required,max=12288"`
		CurrentPassword string `json:"current_password" binding:"required,max=256"`
	}
	if err := bindAuthJSON(c, &input); err != nil {
		respondAuthBindingError(c, err)
		return
	}
	user := utils.MustGetUser(c)
	if user.Password == "" {
		h.respondError(c, errGooglePasswordRequired)
		return
	}
	expires, err := googleauth.ValidateLinkChallenge(configs.App.JWTSecret, input.Challenge, user.ID, time.Now())
	if err != nil {
		h.respondError(c, err)
		return
	}
	identity, valid := h.verifiedIdentity(c, input.Credential, googleauth.LinkNonce(input.Challenge))
	if !valid {
		return
	}
	reservation, admitted := reservePasswordWork(c, h.Passwords)
	if !admitted {
		return
	}
	match, err := reservation.Compare(input.CurrentPassword, user.Password)
	reservation.Close()
	if err != nil {
		h.respondError(c, err)
		return
	}
	if !match {
		h.respondError(c, utils.ErrCredentialsChanged)
		return
	}
	if err := linkGoogleIdentity(c.Request.Context(), h.DB, user, identity.Subject, expires); err != nil {
		h.respondError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func linkGoogleIdentity(ctx context.Context, db *gorm.DB, snapshot *models.User, subject string, expires time.Time) error {
	return utils.WithLockedUser(ctx, utils.PrivateSQL(db), snapshot.ID, func(tx *gorm.DB, owner *models.User) error {
		if owner.Password == "" || owner.Password != snapshot.Password {
			return utils.ErrCredentialsChanged
		}
		if !time.Now().Before(expires) {
			return googleauth.ErrInvalidCredential
		}
		link := models.UserIdentity{UserID: owner.ID, Provider: "google", Issuer: googleauth.Issuer, Subject: subject}
		insert := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&link)
		if insert.Error != nil || insert.RowsAffected == 1 {
			return insert.Error
		}
		// The unique indexes also arbitrate concurrent links from other owners.
		// Only an exact, still-live identity can make a duplicate a successful retry.
		stored, err := findGoogleIdentity(tx, subject)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errGoogleAccountConflict
		}
		if err != nil {
			return err
		}
		if stored.DeletedAt.Valid || stored.Provider != "google" || stored.UserID != owner.ID {
			return errGoogleAccountConflict
		}
		return nil
	})
}
