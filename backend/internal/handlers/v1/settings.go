package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SettingsHandler struct {
	DB *gorm.DB
}

func (h SettingsHandler) GetAllSettings(c *gin.Context) {
	user := utils.MustGetUser(c)

	response := struct {
		CWSettings   common.CWSettingsResponse   `json:"cw_settings"`
		PageSettings common.PageSettingsResponse `json:"page_settings"`
	}{}

	if err := h.DB.Preload("CWSettings").Preload("PageSettings").Model(&models.User{}).Take(user, "id = ?", user.ID).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			slog.Error("Failed to get settings", "user_id", user.ID, "err", err)
			c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeSettingsFetchFailed, "Failed to get settings"))
			return
		}
	}
	var cwSettings models.CWSettings
	var pageSettings models.PageSettings
	if user.CWSettings == nil {
		cwSettings = models.GetDefaultCWSettings()
	} else {
		cwSettings = *user.CWSettings
	}
	if user.PageSettings == nil {
		pageSettings = models.GetDefaultPageSettings()
	} else {
		pageSettings = *user.PageSettings
	}
	response.CWSettings = common.CWSettingsResponse{
		CharWPM:    cwSettings.CharWPM,
		EffWPM:     cwSettings.EffWPM,
		Freq:       cwSettings.Freq,
		StartDelay: cwSettings.StartDelay,
		UpdatedAt:  cwSettings.UpdatedAt,
	}
	response.PageSettings = common.PageSettingsResponse{
		Lang:      pageSettings.Lang,
		CurLesson: pageSettings.CurLesson,
		UpdatedAt: pageSettings.UpdatedAt,
	}
	c.JSON(http.StatusOK, response)
}

func (h SettingsHandler) GetCWSettings(c *gin.Context) {
	user := utils.MustGetUser(c)

	var settings common.CWSettingsResponse
	if err := h.DB.Model(&models.CWSettings{}).Take(&settings, "user_id = ?", user.ID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			cwSettings := models.GetDefaultCWSettings()
			c.JSON(http.StatusOK, common.FromCwSettingsModel(cwSettings))
			return
		}
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeSettingsFetchFailed, "Failed to get settings"))
		slog.Error("Failed to get settings", "user_id", user.ID, "err", err)
		return
	}

	c.JSON(http.StatusOK, settings)
}

func (h SettingsHandler) GetPageSettings(c *gin.Context) {
	user := utils.MustGetUser(c)

	var settings common.PageSettingsResponse
	if err := h.DB.Model(&models.PageSettings{}).Take(&settings, "user_id = ?", user.ID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			pageSettings := models.GetDefaultPageSettings()
			c.JSON(http.StatusOK, common.FromPageSettingsModel(pageSettings))
			return
		}
		slog.Error("Failed to get settings", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeSettingsFetchFailed, "Failed to get settings"))
		return
	}

	c.JSON(http.StatusOK, settings)
}

func (h SettingsHandler) UpdateCWSettings(c *gin.Context) {
	var input common.CWSettingsInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}

	user := utils.MustGetUser(c)
	settings := models.CWSettings{UserID: user.ID}

	if err := h.DB.Where(&settings).Assign(&input).FirstOrCreate(&settings).Error; err != nil {
		slog.Error("Failed to update settings", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeSettingsUpdateFailed, "Failed to update settings"))
		return
	}

	c.JSON(http.StatusOK, common.MessageResponse{Message: "Settings updated"})
}

func (h SettingsHandler) UpdatePageSettings(c *gin.Context) {
	var input common.PageSettingsInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}

	user := utils.MustGetUser(c)
	settings := models.PageSettings{UserID: user.ID}

	if err := h.DB.Where(&settings).Assign(&input).FirstOrCreate(&settings).Error; err != nil {
		slog.Error("Failed to update settings", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeSettingsUpdateFailed, "Failed to update settings"))
		return
	}

	c.JSON(http.StatusOK, common.MessageResponse{Message: "Settings updated"})
}
