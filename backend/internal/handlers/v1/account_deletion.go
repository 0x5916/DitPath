package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"
	"unicode/utf8"

	"morsewell/internal/common"
	"morsewell/internal/configs"
	"morsewell/internal/googleauth"
	"morsewell/internal/models"
	"morsewell/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func deletionFields(c *gin.Context) (map[string]string, bool) {
	body, err := readAuthBody(c)
	var fields map[string]string
	if err == nil {
		err = json.Unmarshal(body, &fields)
	}
	if err != nil || fields == nil {
		respondAuthBindingError(c, err)
		return nil, false
	}
	return fields, true
}

func (h *GoogleAuthHandler) DeletionChallenge(c *gin.Context) {
	fields, ok := deletionFields(c)
	if !ok {
		return
	}
	if len(fields) != 0 {
		respondAuthBindingError(c, nil)
		return
	}
	user := utils.MustGetUser(c)
	if user.Password != "" {
		h.respondError(c, utils.ErrCredentialsChanged)
		return
	}
	challenge, err := googleauth.NewDeletionChallenge(configs.App.JWTSecret, user.ID, time.Now())
	if err != nil {
		h.respondError(c, errGoogleTokenIssue)
		return
	}
	c.JSON(http.StatusOK, gin.H{"challenge": challenge, "nonce": googleauth.LinkNonce(challenge)})
}

func (h *GoogleAuthHandler) DeleteAccount(c *gin.Context) {
	fields, ok := deletionFields(c)
	if !ok {
		return
	}
	user := utils.MustGetUser(c)
	password, challenge, credential := fields["current_password"], fields["challenge"], fields["credential"]
	useGoogle := c.GetHeader("X-OpenCW-Auth") == "google"
	var subject string
	var expires time.Time
	switch {
	case useGoogle && len(fields) == 2 && challenge != "" && len(challenge) <= 1024 && credential != "":
		if user.Password != "" {
			h.respondError(c, utils.ErrCredentialsChanged)
			return
		}
		var err error
		expires, err = googleauth.ValidateDeletionChallenge(configs.App.JWTSecret, challenge, user.ID, time.Now())
		if err != nil {
			h.respondError(c, err)
			return
		}
		identity, verified := h.verifiedIdentity(c, credential, googleauth.LinkNonce(challenge))
		if !verified {
			return
		}
		subject = identity.Subject
	case c.GetHeader("X-OpenCW-Auth") == "" && len(fields) == 1 && password != "" && utf8.RuneCountInString(password) <= 256:
		if user.Password == "" {
			h.respondError(c, errGooglePasswordRequired)
			return
		}
		work, admitted := reservePasswordWork(c, h.Passwords)
		if !admitted {
			return
		}
		match, err := work.Compare(password, user.Password)
		work.Close()
		if err != nil {
			h.respondError(c, err)
			return
		}
		if !match {
			h.respondError(c, utils.ErrCredentialsChanged)
			return
		}
	default:
		respondAuthBindingError(c, nil)
		return
	}

	err := utils.WithLockedUser(c.Request.Context(), utils.PrivateSQL(h.DB), user.ID, func(tx *gorm.DB, owner *models.User) error {
		if useGoogle {
			if owner.Password != "" || subject == "" {
				return googleauth.ErrInvalidCredential
			}
			var identity models.UserIdentity
			err := tx.Select("id").Take(&identity, "user_id=? AND provider='google' AND issuer=? AND subject=?", owner.ID, googleauth.Issuer, subject).Error
			if errors.Is(err, gorm.ErrRecordNotFound) || !time.Now().Before(expires) {
				return googleauth.ErrInvalidCredential
			}
			if err != nil {
				return err
			}
		} else if owner.Password != user.Password {
			return utils.ErrCredentialsChanged
		}
		// These records carry personal data but have no foreign key to users.
		if err := tx.Unscoped().Where("user_id=?", owner.ID).Delete(&models.EmailOTP{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id=?", owner.ID).Delete(&models.OwnerRecipient{}).Error; err != nil {
			return err
		}
		if err := tx.Where("owner_id=?", owner.ID).Delete(&models.OwnerMessage{}).Error; err != nil {
			return err
		}
		// Hard deletion cascades to sessions, settings, history, identities and forum content.
		return tx.Unscoped().Delete(owner).Error
	})
	if errors.Is(err, utils.ErrUserNotFound) {
		c.JSON(http.StatusUnauthorized, common.NewErrorResponse(common.ErrorCodeUserNotFound, "Account unavailable"))
		return
	}
	if err != nil {
		h.respondError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
