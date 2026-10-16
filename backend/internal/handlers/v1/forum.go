package handlers

import (
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const defaultForumThreadLimit = 20

type ForumHandler struct {
	DB *gorm.DB
}

// ListThreads returns forum threads ordered newest first, using cursor-based
// pagination. It is a public endpoint.
func (h ForumHandler) ListThreads(c *gin.Context) {
	var params common.ListThreadsQuery
	if err := c.ShouldBindQuery(&params); err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidQueryParameter, "Invalid query parameters"))
		return
	}

	limit := defaultForumThreadLimit
	if params.Limit > 0 {
		limit = params.Limit
	}

	var cursorTime time.Time
	var cursorID uuid.UUID
	hasCursor := params.Cursor != ""
	if hasCursor {
		t, id, err := decodeThreadCursor(params.Cursor)
		if err != nil {
			c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidQueryParameter, "Invalid cursor"))
			return
		}
		cursorTime, cursorID = t, id
	}

	total, err := h.countThreads(params.Category)
	if err != nil {
		slog.Error("Failed to count forum threads", "category", params.Category, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumQueryFailed, "Failed to query forum threads"))
		return
	}

	threads, err := h.listThreadPage(params.Category, hasCursor, cursorTime, cursorID, limit+1)
	if err != nil {
		slog.Error("Failed to query forum threads", "category", params.Category, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumQueryFailed, "Failed to query forum threads"))
		return
	}

	var nextCursor *string
	if len(threads) > limit {
		threads = threads[:limit]
		cursor := encodeThreadCursor(threads[len(threads)-1].CreatedAt, threads[len(threads)-1].ID)
		nextCursor = &cursor
	}

	replyCounts, err := h.replyCounts(threads)
	if err != nil {
		slog.Error("Failed to query forum reply counts", "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumQueryFailed, "Failed to query forum threads"))
		return
	}

	summaries := make([]common.ForumThreadSummaryResponse, 0, len(threads))
	for i := range threads {
		thread := &threads[i]
		summaries = append(summaries, common.ForumThreadSummaryResponse{
			ID:         thread.ID,
			Category:   thread.Category,
			Title:      thread.Title,
			Author:     forumAuthorResponse(thread.User),
			ReplyCount: replyCounts[thread.ID],
			CreatedAt:  thread.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, common.ForumThreadListResponse{
		Data:       summaries,
		Total:      total,
		Limit:      limit,
		NextCursor: nextCursor,
	})
}

// GetThread returns a single thread. It is a public endpoint.
func (h ForumHandler) GetThread(c *gin.Context) {
	thread, ok := h.lookupThread(c)
	if !ok {
		return
	}

	replyCount, err := h.countReplies(thread.ID)
	if err != nil {
		slog.Error("Failed to count forum replies", "thread_id", thread.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumQueryFailed, "Failed to query forum replies"))
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": forumThreadDetail(thread, replyCount)})
}

// GetThreadReplies returns bounded chronological pages. Parent context keeps
// cross-page conversations readable without recursively expanding descendants.
func (h ForumHandler) GetThreadReplies(c *gin.Context) {
	page, err := common.ParseReadPage(c.Request.URL.Query())
	if err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidQueryParameter, "Invalid query parameters"))
		return
	}
	thread, ok := h.lookupThread(c)
	if !ok {
		return
	}
	db := h.DB.WithContext(c.Request.Context())
	var total, totalRows int64
	if err = db.Model(&models.ForumReply{}).Where("thread_id = ?", thread.ID).Count(&total).Error; err == nil {
		err = db.Unscoped().Model(&models.ForumReply{}).Where("thread_id = ?", thread.ID).Count(&totalRows).Error
	}
	query := db.Unscoped().Where("thread_id = ?", thread.ID)
	if page.HasCursor {
		query = query.Where("(created_at,id) > (?,?)", page.Time, page.ID)
	}
	var replies []models.ForumReply
	if err == nil {
		err = query.Preload("User", func(db *gorm.DB) *gorm.DB { return db.Select("id", "username", "call_sign") }).Order("created_at ASC,id ASC").Limit(page.Limit + 1).Find(&replies).Error
	}
	var next *string
	if len(replies) > page.Limit {
		replies = replies[:page.Limit]
		cursor := common.EncodeReadCursor(replies[len(replies)-1].CreatedAt, replies[len(replies)-1].ID)
		next = &cursor
	}
	parentIDs := make([]uuid.UUID, 0, len(replies))
	for _, reply := range replies {
		if reply.ParentID != nil {
			parentIDs = append(parentIDs, *reply.ParentID)
		}
	}
	var parents []models.ForumReply
	if err == nil && len(parentIDs) > 0 {
		err = db.Unscoped().Select("id", "user_id", "deleted_at", "LEFT(body,160) AS body").
			Preload("User", func(db *gorm.DB) *gorm.DB { return db.Select("id", "username", "call_sign") }).
			Where("thread_id = ? AND id IN ?", thread.ID, parentIDs).Find(&parents).Error
	}
	if err != nil {
		slog.Error("Failed to query forum replies", "thread_id", thread.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumQueryFailed, "Failed to query forum replies"))
		return
	}
	contexts := make(map[uuid.UUID]*common.ForumParentContext, len(parents))
	for _, parent := range parents {
		context := &common.ForumParentContext{IsDeleted: parent.DeletedAt.Valid}
		if !context.IsDeleted {
			body := parent.Body
			context.Body = &body
			context.Author = forumAuthorResponse(parent.User)
		}
		contexts[parent.ID] = context
	}
	data := make([]common.ForumReplyResponse, 0, len(replies))
	for _, reply := range replies {
		item := forumReplyDetail(&reply)
		item.IsDeleted = reply.DeletedAt.Valid
		if item.IsDeleted {
			item.Body = nil
			item.Author = nil
		}
		if reply.ParentID != nil {
			item.ParentContext = contexts[*reply.ParentID]
		}
		data = append(data, item)
	}
	c.JSON(http.StatusOK, common.ForumReplyListResponse{Data: data, Total: total, TotalRows: totalRows, Limit: page.Limit, NextCursor: next})
}

// CreateThread creates a new thread. Only users with a verified email can
// reach this handler (VerifiedRequired middleware).
func (h ForumHandler) CreateThread(c *gin.Context) {
	user := utils.MustGetUser(c)

	var input common.CreateThreadInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}

	thread := models.ForumThread{
		UserID:   user.ID,
		Category: input.Category,
		Title:    input.Title,
		Body:     input.Body,
	}
	if err := h.DB.Create(&thread).Error; err != nil {
		slog.Error("Failed to create forum thread", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumCreateFailed, "Failed to create forum thread"))
		return
	}

	thread.User = user
	c.JSON(http.StatusCreated, gin.H{"data": forumThreadDetail(&thread, 0)})
}

// CreateReply creates a reply in a thread. Only users with a verified email can
// reach this handler (VerifiedRequired middleware). An optional parent_id must
// reference a live reply in the same thread.
func (h ForumHandler) CreateReply(c *gin.Context) {
	user := utils.MustGetUser(c)

	thread, ok := h.lookupThread(c)
	if !ok {
		return
	}

	var input common.CreateReplyInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}

	if input.ParentID != nil {
		var parent models.ForumReply
		if err := h.DB.Where("id = ? AND thread_id = ?", *input.ParentID, thread.ID).Take(&parent).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeReplyNotFound, "Parent reply not found in this thread"))
			} else {
				slog.Error("Failed to query parent reply", "thread_id", thread.ID, "parent_id", *input.ParentID, "err", err)
				c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumQueryFailed, "Failed to query parent reply"))
			}
			return
		}
	}

	reply := models.ForumReply{
		ThreadID: thread.ID,
		UserID:   user.ID,
		ParentID: input.ParentID,
		Body:     input.Body,
	}
	if err := h.DB.Create(&reply).Error; err != nil {
		slog.Error("Failed to create forum reply", "user_id", user.ID, "thread_id", thread.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumCreateFailed, "Failed to create forum reply"))
		return
	}

	reply.User = user
	c.JSON(http.StatusCreated, gin.H{"data": forumReplyDetail(&reply)})
}

// DeleteThread soft-deletes a thread. Any authenticated user may delete their
// own threads.
func (h ForumHandler) DeleteThread(c *gin.Context) {
	user := utils.MustGetUser(c)

	thread, ok := h.lookupThread(c)
	if !ok {
		return
	}

	if thread.UserID != user.ID {
		c.JSON(http.StatusForbidden, common.NewErrorResponse(common.ErrorCodeNotAuthor, "Only the author can delete this thread"))
		return
	}

	if err := h.DB.Delete(thread).Error; err != nil {
		slog.Error("Failed to delete forum thread", "thread_id", thread.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumDeleteFailed, "Failed to delete forum thread"))
		return
	}

	c.JSON(http.StatusOK, common.MessageResponse{Message: "Thread deleted"})
}

// DeleteReply soft-deletes a reply. Any authenticated user may delete their own
// replies.
func (h ForumHandler) DeleteReply(c *gin.Context) {
	user := utils.MustGetUser(c)

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, common.NewErrorResponse(common.ErrorCodeReplyNotFound, "Reply not found"))
		return
	}

	var reply models.ForumReply
	if err := h.DB.Take(&reply, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, common.NewErrorResponse(common.ErrorCodeReplyNotFound, "Reply not found"))
		} else {
			slog.Error("Failed to query forum reply", "reply_id", id, "err", err)
			c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumQueryFailed, "Failed to query forum reply"))
		}
		return
	}

	if reply.UserID != user.ID {
		c.JSON(http.StatusForbidden, common.NewErrorResponse(common.ErrorCodeNotAuthor, "Only the author can delete this reply"))
		return
	}

	if err := h.DB.Delete(&reply).Error; err != nil {
		slog.Error("Failed to delete forum reply", "reply_id", reply.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumDeleteFailed, "Failed to delete forum reply"))
		return
	}

	c.JSON(http.StatusOK, common.MessageResponse{Message: "Reply deleted"})
}

// lookupThread resolves the :id path parameter to a live thread, writing the
// error response itself when it fails.
func (h ForumHandler) lookupThread(c *gin.Context) (*models.ForumThread, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, common.NewErrorResponse(common.ErrorCodeThreadNotFound, "Thread not found"))
		return nil, false
	}

	var thread models.ForumThread
	if err := h.DB.WithContext(c.Request.Context()).Preload("User").Take(&thread, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, common.NewErrorResponse(common.ErrorCodeThreadNotFound, "Thread not found"))
		} else {
			slog.Error("Failed to query forum thread", "thread_id", id, "err", err)
			c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumQueryFailed, "Failed to query forum thread"))
		}
		return nil, false
	}

	return &thread, true
}

func (h ForumHandler) countThreads(category string) (int64, error) {
	query := h.DB.Model(&models.ForumThread{})
	if category != "" {
		query = query.Where("category = ?", category)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return 0, err
	}
	return total, nil
}

func (h ForumHandler) listThreadPage(category string, hasCursor bool, cursorTime time.Time, cursorID uuid.UUID, limit int) ([]models.ForumThread, error) {
	query := h.DB.Model(&models.ForumThread{})
	if category != "" {
		query = query.Where("category = ?", category)
	}
	if hasCursor {
		query = query.Where("(created_at, id) < (?, ?)", cursorTime, cursorID)
	}

	var threads []models.ForumThread
	if err := query.Preload("User").
		Order("created_at DESC, id DESC").
		Limit(limit).
		Find(&threads).Error; err != nil {
		return nil, err
	}
	return threads, nil
}

func (h ForumHandler) countReplies(threadID uuid.UUID) (int64, error) {
	var count int64
	if err := h.DB.Model(&models.ForumReply{}).
		Where("thread_id = ?", threadID).
		Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

func (h ForumHandler) replyCounts(threads []models.ForumThread) (map[uuid.UUID]int64, error) {
	counts := make(map[uuid.UUID]int64, len(threads))
	if len(threads) == 0 {
		return counts, nil
	}

	ids := make([]uuid.UUID, 0, len(threads))
	for i := range threads {
		ids = append(ids, threads[i].ID)
	}

	type replyCountRow struct {
		ThreadID uuid.UUID
		Count    int64
	}

	var rows []replyCountRow
	if err := h.DB.Model(&models.ForumReply{}).
		Select("thread_id, COUNT(*) AS count").
		Where("thread_id IN ? AND deleted_at IS NULL", ids).
		Group("thread_id").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	for _, row := range rows {
		counts[row.ThreadID] = row.Count
	}
	return counts, nil
}

func forumAuthorResponse(user *models.User) *common.ForumAuthorResponse {
	if user == nil {
		return nil
	}

	return &common.ForumAuthorResponse{
		Username: user.Username,
		CallSign: user.CallSign,
	}
}

func forumThreadDetail(thread *models.ForumThread, replyCount int64) common.ForumThreadResponse {
	return common.ForumThreadResponse{
		ID:         thread.ID,
		Category:   thread.Category,
		Title:      thread.Title,
		Body:       thread.Body,
		Author:     forumAuthorResponse(thread.User),
		ReplyCount: replyCount,
		CreatedAt:  thread.CreatedAt,
		UpdatedAt:  thread.UpdatedAt,
	}
}

func forumReplyDetail(reply *models.ForumReply) common.ForumReplyResponse {
	body := reply.Body
	return common.ForumReplyResponse{
		ID:        reply.ID,
		ParentID:  reply.ParentID,
		Body:      &body,
		Author:    forumAuthorResponse(reply.User),
		CreatedAt: reply.CreatedAt,
		Children:  []common.ForumReplyResponse{},
	}
}

// encodeThreadCursor builds an opaque cursor from the last thread of a page.
func encodeThreadCursor(createdAt time.Time, id uuid.UUID) string {
	raw := createdAt.UTC().Format(time.RFC3339Nano) + "|" + id.String()
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeThreadCursor(cursor string) (time.Time, uuid.UUID, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}

	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, uuid.Nil, errors.New("malformed cursor")
	}

	createdAt, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}

	id, err := uuid.Parse(parts[1])
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}

	return createdAt, id, nil
}
