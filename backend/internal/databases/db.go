package databases

import (
	"fmt"
	"log/slog"

	"opencw/internal/configs"
	"opencw/internal/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func Connect() error {
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
		return fmt.Errorf("connect to database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("get underlying database connection: %w", err)
	}
	if err := migrate(db); err != nil {
		if closeErr := sqlDB.Close(); closeErr != nil {
			slog.Error("Failed to close database after initialization error", "err", closeErr)
		}
		return err
	}

	sqlDB.SetMaxOpenConns(configs.App.DBMaxOpenConns)
	sqlDB.SetMaxIdleConns(configs.App.DBMaxIdleConns)
	sqlDB.SetConnMaxLifetime(configs.App.DBConnMaxLifetime)
	sqlDB.SetConnMaxIdleTime(configs.App.DBConnMaxIdleTime)
	DB = db

	slog.Info("Database connected and migrated successfully")
	return nil
}

type schemaDatabase interface {
	AutoMigrate(...interface{}) error
	Exec(string, ...interface{}) *gorm.DB
}

func migrate(db schemaDatabase) error {
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
		&models.TrainingSession{},
		&models.TrainingSyncState{},
		&models.TrainingChange{},
	); err != nil {
		return fmt.Errorf("migrate database: %w", err)
	}

	if err := ensureUserEmailIndexes(db); err != nil {
		return fmt.Errorf("migrate user email indexes: %w", err)
	}

	if err := ensureForumIndexes(db); err != nil {
		return fmt.Errorf("migrate forum indexes: %w", err)
	}
	if err := ensureTrainingIndexes(db); err != nil {
		return fmt.Errorf("migrate training indexes: %w", err)
	}

	return nil
}

func ensureTrainingIndexes(db schemaDatabase) error {
	statements := []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_training_sessions_legacy_source ON training_sessions (user_id, source_kind, source_record_id);`,
		`CREATE INDEX IF NOT EXISTS idx_training_sessions_history ON training_sessions (user_id, occurred_at DESC, id DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_training_sessions_filter ON training_sessions (user_id, mode, status, occurred_at DESC, id DESC);`,
	}
	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			return err
		}
	}
	return nil
}

func ensureUserEmailIndexes(db schemaDatabase) error {
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

func ensureForumIndexes(db schemaDatabase) error {
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
