package databases

import (
	"fmt"
	"log/slog"
	"os"

	"opencw/internal/configs"
	"opencw/internal/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func Connect() {
	dsn := fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s port=%s sslmode=disable TimeZone=UTC",
		configs.App.DBHost,
		configs.App.DBUser,
		configs.App.DBPassword,
		configs.App.DBName,
		configs.App.DBPort,
	)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{TranslateError: true, PrepareStmt: true})
	if err != nil {
		slog.Error("Failed to connect to database", "err", err)
		os.Exit(1)
	}

	if err := db.AutoMigrate(
		&models.User{},
		&models.EmailOTP{},
		&models.RefreshToken{},
		&models.CWSettings{},
		&models.PageSettings{},
		&models.Progress{},
		&models.ForumThread{},
		&models.ForumReply{},
		&models.TrainingEvent{},
		&models.TrainingProfile{},
	); err != nil {
		slog.Error("Failed to migrate database", "err", err)
	}

	if err := ensureUserEmailIndexes(db); err != nil {
		slog.Error("Failed to migrate user email indexes", "err", err)
	}

	if err := ensureForumIndexes(db); err != nil {
		slog.Error("Failed to migrate forum indexes", "err", err)
	}

	DB = db

	sqlDB, err := db.DB()
	if err != nil {
		slog.Error("Failed to get underlying sql.DB", "err", err)
		os.Exit(1)
	}
	sqlDB.SetMaxOpenConns(configs.App.DBMaxOpenConns)
	sqlDB.SetMaxIdleConns(configs.App.DBMaxIdleConns)
	sqlDB.SetConnMaxLifetime(configs.App.DBConnMaxLifetime)
	sqlDB.SetConnMaxIdleTime(configs.App.DBConnMaxIdleTime)

	slog.Info("Database connected and migrated successfully")
}

func ensureUserEmailIndexes(db *gorm.DB) error {
	statements := []string{
		`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;`,
		`DROP INDEX IF EXISTS idx_users_email;`,
		`CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_verified_email ON users (email) WHERE email_verified = true AND deleted_at IS NULL;`,
	}

	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			return err
		}
	}

	return nil
}

func ensureForumIndexes(db *gorm.DB) error {
	statements := []string{
		`CREATE INDEX IF NOT EXISTS idx_forum_threads_created_at_id ON forum_threads (created_at DESC, id DESC) WHERE deleted_at IS NULL;`,
	}

	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			return err
		}
	}

	return nil
}
