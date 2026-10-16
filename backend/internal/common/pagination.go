package common

import (
	"encoding/base64"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

const ReadPageLimit = 100

type ReadPage struct {
	Limit     int
	Time      time.Time
	ID        uuid.UUID
	HasCursor bool
}

// ParseReadPage validates bounded keyset pagination without accepting ambiguous
// duplicate query parameters or opaque cursors of unbounded size.
func ParseReadPage(values url.Values) (ReadPage, error) {
	page := ReadPage{Limit: ReadPageLimit}
	if limits, ok := values["limit"]; ok {
		if len(limits) != 1 {
			return page, errors.New("invalid limit")
		}
		limit, err := strconv.Atoi(limits[0])
		if err != nil || limit < 1 || limit > ReadPageLimit {
			return page, errors.New("invalid limit")
		}
		page.Limit = limit
	}
	if cursors, ok := values["cursor"]; ok {
		if len(cursors) != 1 || cursors[0] == "" || len(cursors[0]) > 256 {
			return page, errors.New("invalid cursor")
		}
		raw, err := base64.RawURLEncoding.DecodeString(cursors[0])
		if err != nil {
			return page, err
		}
		parts := strings.Split(string(raw), "|")
		if len(parts) != 2 {
			return page, errors.New("invalid cursor")
		}
		page.Time, err = time.Parse(time.RFC3339Nano, parts[0])
		if err != nil {
			return page, err
		}
		if parts[0] != page.Time.UTC().Format(time.RFC3339Nano) {
			return page, errors.New("invalid cursor timestamp")
		}
		page.ID, err = uuid.Parse(parts[1])
		if err != nil || page.ID == uuid.Nil || page.ID.String() != parts[1] {
			return page, errors.New("invalid cursor")
		}
		page.HasCursor = true
	}
	return page, nil
}

func EncodeReadCursor(createdAt time.Time, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString([]byte(createdAt.UTC().Format(time.RFC3339Nano) + "|" + id.String()))
}
