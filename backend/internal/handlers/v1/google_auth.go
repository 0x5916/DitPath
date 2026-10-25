package handlers

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"opencw/internal/common"
	"opencw/internal/googleauth"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
	"gorm.io/gorm"
)

type GoogleAuthHandler struct {
	DB     *gorm.DB
	Verify func(context.Context, string, string) (googleauth.Identity, error)
}

type googleAuthInput struct {
	Credential string `json:"credential" binding:"required,max=12288"`
	Nonce      string `json:"nonce" binding:"required"`
	Username   string `json:"username"`
}

var (
	errGoogleAccountConflict  = errors.New("Google identity unavailable for this account")
	errGoogleUsernameConflict = errors.New("Google registration username conflict")
	errGoogleTokenIssue       = errors.New("Google token issuance failed")
)

func (h *GoogleAuthHandler) Login(c *gin.Context)    { h.authenticate(c, false) }
func (h *GoogleAuthHandler) Register(c *gin.Context) { h.authenticate(c, true) }

func (h *GoogleAuthHandler) authenticate(c *gin.Context, register bool) {
	c.Header("Cache-Control", "no-store")
	if authCanceled(c, nil) {
		return
	}
	var input googleAuthInput
	if err := bindAuthJSON(c, &input); err != nil {
		respondAuthBindingError(c, err)
		return
	}
	if len(input.Credential) > 12*1024 {
		respondAuthBindingError(c, errors.New("credential exceeds byte limit"))
		return
	}
	nonce, err := base64.RawURLEncoding.Strict().DecodeString(input.Nonce)
	if err != nil || len(nonce) != 32 || base64.RawURLEncoding.EncodeToString(nonce) != input.Nonce {
		respondAuthBindingError(c, errors.New("invalid nonce"))
		return
	}
	if h.Verify == nil {
		h.respondError(c, googleauth.ErrUnavailable)
		return
	}
	identity, err := h.Verify(c.Request.Context(), input.Credential, input.Nonce)
	if err != nil {
		h.respondError(c, err)
		return
	}
	if identity.Subject == "" || len(identity.Subject) > 255 {
		h.respondError(c, googleauth.ErrInvalidCredential)
		return
	}
	db := h.DB.WithContext(c.Request.Context())
	stored, err := findGoogleIdentity(db, identity.Subject)
	if err == nil {
		pair, err := issueGoogleTokens(db, stored)
		if err != nil {
			h.respondError(c, err)
			return
		}
		c.JSON(http.StatusOK, pair)
		return
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		h.respondError(c, err)
		return
	}
	if !register {
		c.JSON(http.StatusConflict, common.NewErrorResponse(common.ErrorCodeGoogleSignupRequired, "Choose a username to create your account."))
		return
	}
	if err := binding.Validator.ValidateStruct(&struct {
		Username string `binding:"required,username"`
	}{input.Username}); err != nil {
		respondAuthBindingError(c, err)
		return
	}
	if !identity.EmailVerified || binding.Validator.ValidateStruct(&struct {
		Email string `binding:"required,email,max=254"`
	}{identity.Email}) != nil {
		h.respondError(c, googleauth.ErrInvalidCredential)
		return
	}
	pair, err := h.createGoogleAccount(db, identity, input.Username)
	if err != nil {
		h.respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, pair)
}

func findGoogleIdentity(db *gorm.DB, subject string) (models.UserIdentity, error) {
	var identity models.UserIdentity
	err := db.Unscoped().Take(&identity, "issuer = ? AND subject = ?", googleauth.Issuer, subject).Error
	return identity, err
}

func issueGoogleTokens(db *gorm.DB, identity models.UserIdentity) (common.AuthTokenPairResponse, error) {
	var pair common.AuthTokenPairResponse
	if identity.DeletedAt.Valid || identity.Provider != "google" {
		return pair, errGoogleAccountConflict
	}
	err := utils.WithLockedUser(db.Statement.Context, db, identity.UserID, func(tx *gorm.DB, user *models.User) error {
		current, err := findGoogleIdentity(tx, identity.Subject)
		if err != nil {
			return err
		}
		if current.ID != identity.ID || current.UserID != user.ID || current.DeletedAt.Valid || current.Provider != "google" {
			return errGoogleAccountConflict
		}
		pair.RefreshToken, pair.AccessToken, err = utils.IssueTokenPair(tx, user.ID, user.Password, time.Now())
		if err != nil {
			return fmt.Errorf("%w: %w", errGoogleTokenIssue, err)
		}
		return nil
	})
	return pair, err
}

func (h *GoogleAuthHandler) createGoogleAccount(db *gorm.DB, identity googleauth.Identity, username string) (common.AuthTokenPairResponse, error) {
	var pair common.AuthTokenPairResponse
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := googleVerifiedEmailConflict(tx, identity.Email); err != nil {
			return err
		}
		user := models.User{Username: username, Email: identity.Email,
			EmailVerified: strings.HasSuffix(strings.ToLower(identity.Email), "@gmail.com") || identity.HostedDomain != ""}
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		stored := models.UserIdentity{UserID: user.ID, Provider: "google", Issuer: googleauth.Issuer, Subject: identity.Subject}
		if err := tx.Create(&stored).Error; err != nil {
			return err
		}
		var err error
		pair, err = issueGoogleTokens(tx, stored)
		return err
	})
	if !errors.Is(err, gorm.ErrDuplicatedKey) && !errors.Is(err, errGoogleAccountConflict) {
		return pair, err
	}
	// A unique-index loser must leave its aborted transaction before looking up
	// the winner. Resolve the identity first so username/email races cannot fork it.
	stored, lookupErr := findGoogleIdentity(db, identity.Subject)
	if lookupErr == nil {
		return issueGoogleTokens(db, stored)
	}
	if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		return pair, lookupErr
	}
	if errors.Is(err, errGoogleAccountConflict) {
		return pair, err
	}
	if conflict := googleVerifiedEmailConflict(db, identity.Email); conflict != nil {
		return pair, conflict
	}
	var count int64
	if lookupErr := db.Unscoped().Model(&models.User{}).Where("username = ?", username).Count(&count).Error; lookupErr != nil {
		return pair, lookupErr
	}
	if count > 0 {
		return pair, errGoogleUsernameConflict
	}
	return pair, err
}

func googleVerifiedEmailConflict(db *gorm.DB, email string) error {
	var count int64
	if err := db.Model(&models.User{}).Where("email = ? AND email_verified = true", email).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return errGoogleAccountConflict
	}
	return nil
}

func (h *GoogleAuthHandler) respondError(c *gin.Context, err error) {
	if authCanceled(c, err) {
		return
	}
	status, code, message := http.StatusInternalServerError, common.ErrorCodeDatabaseFailure, "Google sign-in failed. Please try again."
	switch {
	case errors.Is(err, googleauth.ErrInvalidCredential):
		status, code = http.StatusUnauthorized, common.ErrorCodeGoogleCredentialInvalid
	case errors.Is(err, googleauth.ErrUnavailable):
		status, code = http.StatusServiceUnavailable, common.ErrorCodeGoogleSignInUnavailable
		c.Header("Retry-After", "1")
	case errors.Is(err, errGoogleAccountConflict), errors.Is(err, utils.ErrUserNotFound), errors.Is(err, gorm.ErrRecordNotFound):
		status, code = http.StatusConflict, common.ErrorCodeGoogleAccountConflict
	case errors.Is(err, errGoogleUsernameConflict):
		status, code = http.StatusConflict, common.ErrorCodeUsernameAlreadyInUse
	case errors.Is(err, errGoogleTokenIssue):
		code = common.ErrorCodeTokenIssueFailed
	}
	if status == http.StatusInternalServerError {
		slog.Error("Google authentication persistence failed", "err", err)
	}
	c.JSON(status, common.NewErrorResponse(code, message))
}
