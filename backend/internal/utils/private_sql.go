package utils

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// PrivateSQL retains query timings and errors without interpolating private
// email, message text, consent tokens or OTPs into SQL traces.
func PrivateSQL(db *gorm.DB) *gorm.DB {
	return db.Session(&gorm.Session{Logger: privateSQLLogger{db.Logger}})
}

type privateSQLLogger struct{ logger.Interface }

func (l privateSQLLogger) LogMode(level logger.LogLevel) logger.Interface {
	return privateSQLLogger{l.Interface.LogMode(level)}
}

func (privateSQLLogger) ParamsFilter(_ context.Context, query string, _ ...interface{}) (string, []interface{}) {
	return query, nil
}
