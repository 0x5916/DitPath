package handlers

import (
	"database/sql/driver"
	"fmt"
	"testing"
	"time"
)

func TestForumReplyMappingResponseSnapshots(t *testing.T) {
	for _, parent := range []string{"live", "deleted", "missing", "none"} {
		for _, deleted := range []bool{false, true} {
			for _, authorPresent := range []bool{false, true} {
				name := fmt.Sprintf("parent=%s/deleted=%t/author=%t", parent, deleted, authorPresent)
				t.Run(name, func(t *testing.T) {
					queries := forumReadQueries()
					now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
					var deletedAt driver.Value
					liveCount, bodyJSON := int64(1), `""`
					authorJSON := `{"username":"reader","call_sign":"N0CALL"}`
					if !authorPresent {
						queries[5].Rows, queries[7].Rows = nil, nil
						authorJSON = "null"
					}
					parentAuthorJSON := authorJSON
					if deleted {
						deletedAt, liveCount, bodyJSON, authorJSON = now, 0, "null", "null"
					}
					queries[2].Rows = [][]driver.Value{{liveCount}}
					queries[3].Rows = [][]driver.Value{{int64(1)}}
					// An empty live body must remain a string; deletion must redact it.
					queries[4].Rows = [][]driver.Value{{forumReadID(11), forumReadID(2), forumReadID(21), "", now, deletedAt}}
					queries[6].SQL = `SELECT "id","user_id","deleted_at",LEFT(body,160) AS body FROM "forum_replies" WHERE thread_id = $1 AND id IN ($2)`
					queries[6].Args = []any{forumReadID(1), forumReadID(21)}
					queries[6].Rows = [][]driver.Value{{forumReadID(21), forumReadID(2), nil, ""}}
					parentJSON := `"00000000-0000-7000-8000-000000000015"`
					parentContext := `,"parent_context":{"author":` + parentAuthorJSON + `,"body":"","is_deleted":false}`
					switch parent {
					case "deleted":
						queries[6].Rows[0][2] = now
						parentContext = `,"parent_context":{"author":null,"body":null,"is_deleted":true}`
					case "missing":
						queries[6].Rows = nil
						queries = queries[:7]
						parentContext = ""
					case "none":
						queries[4].Rows[0][2] = nil
						queries = queries[:6]
						parentJSON, parentContext = "null", ""
					}
					// Deleted replies retain the same independently redacted parent context.
					body := fmt.Sprintf(`{"data":[{"id":"00000000-0000-7000-8000-00000000000b","parent_id":%s,"body":%s,"author":%s,"is_deleted":%t,"created_at":"2026-10-16T00:00:00Z","children":[]%s}],"total":%d,"total_rows":1,"limit":3,"next_cursor":null}`,
						parentJSON, bodyJSON, authorJSON, deleted, parentContext, liveCount)
					forumReadSnapshot(t, queries, forumReadID(1), "limit=3&cursor="+forumReadCursor, 200, body)
				})
			}
		}
	}
}
