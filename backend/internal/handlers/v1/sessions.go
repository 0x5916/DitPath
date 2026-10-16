package handlers

import (
	"context"
	"errors"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func changePasswordTransaction(ctx context.Context, db *gorm.DB, id uuid.UUID, expectedHash, newHash string) error {
	return utils.WithLockedUser(ctx, db, id, func(tx *gorm.DB, user *models.User) error {
		if user.Password != expectedHash {
			return utils.ErrCredentialsChanged
		}
		update := tx.Model(user).Update("password", newHash)
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&models.RefreshToken{}).Where("user_id = ? AND revoked = false", id).Update("revoked", true).Error
	})
}

func refreshTokenPair(ctx context.Context, db *gorm.DB, hashedInput string) (string, string, error) {
	// Resolve ownership before the account lock. This read authorizes nothing;
	// every token property is read again after the shared account lock.
	var owner models.RefreshToken
	if err := db.WithContext(ctx).Select("user_id").Take(&owner, "token = ?", hashedInput).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", "", common.ErrInvalidToken
		}
		return "", "", err
	}
	var raw, access string
	err := utils.WithLockedUser(ctx, db, owner.UserID, func(tx *gorm.DB, user *models.User) error {
		var token models.RefreshToken
		if err := tx.Take(&token, "user_id = ? AND token = ? AND revoked = false", user.ID, hashedInput).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.ErrInvalidToken
			}
			return err
		}
		now := time.Now()
		if !token.ExpiresAt.After(now) {
			return common.ErrExpiredToken
		}
		claim := tx.Model(&token).Where("revoked = false").Update("revoked", true)
		if claim.Error != nil {
			return claim.Error
		}
		if claim.RowsAffected != 1 {
			return common.ErrInvalidToken
		}
		var hashed string
		var err error
		raw, hashed, err = utils.GenerateRefreshToken()
		if err != nil {
			return err
		}
		access, err = utils.GenerateAccessToken(user.ID, now)
		if err != nil {
			return err
		}
		return tx.Create(&models.RefreshToken{UserID: user.ID, Token: hashed,
			ExpiresAt: now.Add(30 * 24 * time.Hour)}).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = common.ErrInvalidToken
	}
	if err != nil {
		return "", "", err
	}
	return raw, access, nil
}
