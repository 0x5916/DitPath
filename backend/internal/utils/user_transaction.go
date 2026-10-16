package utils

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"opencw/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrUserNotFound = errors.New("locked account not found")

// WithLockedUser serializes account mutations and session issuance across API
// instances. Password work must finish before entering this transaction.
func WithLockedUser(ctx context.Context, db *gorm.DB, id uuid.UUID, mutate func(*gorm.DB, *models.User) error) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user models.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Take(&user, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return fmt.Errorf("%w: %w", ErrUserNotFound, err)
			}
			return err
		}
		return mutate(tx, &user)
	}, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
}
