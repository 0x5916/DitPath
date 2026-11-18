package handlers

import (
	"errors"
	"net/http"

	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type EmailPreferencesHandler struct{ DB *gorm.DB }

func privateMailDB(c *gin.Context, db *gorm.DB) *gorm.DB {
	c.Header("Cache-Control", "no-store")
	return utils.PrivateSQL(db.WithContext(c.Request.Context()))
}

func emailPreferences(tx *gorm.DB, u *models.User) (gin.H, error) {
	result := gin.H{"email": u.Email, "verified": u.EmailVerified, "support": false, "product": false}
	if !u.EmailVerified {
		return result, nil
	}
	var topics []string
	err := tx.Model(&models.EmailConsent{}).Where("user_id=? AND email=?", u.ID, u.Email).Pluck("topic", &topics).Error
	for _, topic := range topics {
		result[topic] = true
	}
	return result, err
}

func (h EmailPreferencesHandler) Get(c *gin.Context) {
	prefs, err := emailPreferences(privateMailDB(c, h.DB), utils.MustGetUser(c))
	if err != nil {
		adminDBFailure(c)
		return
	}
	c.JSON(http.StatusOK, prefs)
}

func (h EmailPreferencesHandler) Update(c *gin.Context) {
	db := privateMailDB(c, h.DB)
	var input struct {
		Topic   string `json:"topic" binding:"required,oneof=support product"`
		Email   string `json:"email" binding:"required,max=254"`
		Enabled *bool  `json:"enabled" binding:"required"`
	}
	if err := bindAuthJSON(c, &input); err != nil {
		respondAuthBindingError(c, err)
		return
	}
	var result gin.H
	err := utils.WithLockedUser(c.Request.Context(), db, utils.MustGetUser(c).ID, func(tx *gorm.DB, u *models.User) error {
		if input.Email != u.Email {
			return errAddressChanged
		}
		if *input.Enabled {
			if !u.EmailVerified {
				return errUnverified
			}
			row := models.EmailConsent{ID: uuid.New(), UserID: u.ID, Email: u.Email, Topic: input.Topic, Token: uuid.New()}
			if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "topic"}}, DoNothing: true}).Create(&row).Error; err != nil {
				return err
			}
		} else if err := tx.Where("user_id=? AND topic=?", u.ID, input.Topic).Delete(&models.EmailConsent{}).Error; err != nil {
			return err
		}
		var err error
		result, err = emailPreferences(tx, u)
		return err
	})
	switch {
	case errors.Is(err, errAddressChanged):
		c.JSON(409, common.NewErrorResponse("MAIL_ADDRESS_CHANGED", "Reload the account email"))
	case errors.Is(err, errUnverified):
		c.JSON(403, common.NewErrorResponse(common.ErrorCodeEmailNotVerified, "Verify the email address first"))
	case errors.Is(err, utils.ErrUserNotFound):
		c.JSON(401, common.NewErrorResponse(common.ErrorCodeUserNotFound, "Account unavailable"))
	case err != nil:
		adminDBFailure(c)
	default:
		c.JSON(200, result)
	}
}

var errAddressChanged = errors.New("address changed")
var errUnverified = errors.New("unverified address")
