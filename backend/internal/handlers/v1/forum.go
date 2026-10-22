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

	page := common.ReadPage{Limit: defaultForumThreadLimit, HasCursor: params.Cursor != ""}
	if params.Limit > 0 {
		page.Limit = params.Limit
	}

	if page.HasCursor {
		var err error
		page.Time, page.ID, err = decodeThreadCursor(params.Cursor)
		if err != nil {
			c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidQueryParameter, "Invalid cursor"))
			return
		}
	}

	response, err := loadForumThreadPage(h.DB, params.Category, page)
	if err != nil {
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumQueryFailed, "Failed to query forum threads"))
		return
	}
	c.JSON(http.StatusOK, response)
}

func loadForumThreadPage(db *gorm.DB, category string, page common.ReadPage) (*common.ForumThreadListResponse, error) {
	response := &common.ForumThreadListResponse{Limit: page.Limit}
	countQuery := db.Model(&models.ForumThread{})
	if category != "" {
		countQuery = countQuery.Where("category = ?", category)
	}
	if err := countQuery.Count(&response.Total).Error; err != nil {
		slog.Error("Failed to count forum threads", "category", category, "err", err)
		return nil, err
	}

	query := db.Model(&models.ForumThread{})
	if category != "" {
		query = query.Where("category = ?", category)
	}
	if page.HasCursor {
		query = query.Where("(created_at, id) < (?, ?)", page.Time, page.ID)
	}
	var threads []models.ForumThread
	if err := query.Preload("User").
		Order("created_at DESC, id DESC").
		Limit(page.Limit + 1).
		Find(&threads).Error; err != nil {
		slog.Error("Failed to query forum threads", "category", category, "err", err)
		return nil, err
	}

	if len(threads) > page.Limit {
		threads = threads[:page.Limit]
		cursor := common.EncodeReadCursor(threads[len(threads)-1].CreatedAt, threads[len(threads)-1].ID)
		response.NextCursor = &cursor
	}
	response.Data = make([]common.ForumThreadSummaryResponse, 0, len(threads))
	if len(threads) == 0 {
		return response, nil
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
	if err := db.Model(&models.ForumReply{}).
		Select("thread_id, COUNT(*) AS count").
		Where("thread_id IN ? AND deleted_at IS NULL", ids).
		Group("thread_id").
		Scan(&rows).Error; err != nil {
		slog.Error("Failed to query forum reply counts", "err", err)
		return nil, err
	}

	replyCounts := make(map[uuid.UUID]int64, len(threads))
	for _, row := range rows {
		replyCounts[row.ThreadID] = row.Count
	}
	for i := range threads {
		thread := &threads[i]
		response.Data = append(response.Data, common.ForumThreadSummaryResponse{
			ID:         thread.ID,
			Category:   thread.Category,
			Title:      thread.Title,
			Author:     forumAuthorResponse(thread.User),
			ReplyCount: replyCounts[thread.ID],
			CreatedAt:  thread.CreatedAt,
		})
	}

	return response, nil
}

// GetThread returns a single thread. It is a public endpoint.
func (h ForumHandler) GetThread(c *gin.Context) {
	thread, ok := h.lookupThread(c)
	if !ok {
		return
	}

	var replyCount int64
	if err := h.DB.Model(&models.ForumReply{}).
		Where("thread_id = ?", thread.ID).
		Count(&replyCount).Error; err != nil {
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
	response, err := loadForumReplyPage(h.DB.WithContext(c.Request.Context()), thread.ID, page)
	if err != nil {
		slog.Error("Failed to query forum replies", "thread_id", thread.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumQueryFailed, "Failed to query forum replies"))
		return
	}
	c.JSON(http.StatusOK, response)
}

func loadForumReplyPage(db *gorm.DB, threadID uuid.UUID, page common.ReadPage) (*common.ForumReplyListResponse, error) {
	response := &common.ForumReplyListResponse{Limit: page.Limit}
	if err := db.Model(&models.ForumReply{}).Where("thread_id = ?", threadID).Count(&response.Total).Error; err != nil {
		return nil, err
	}
	if err := db.Unscoped().Model(&models.ForumReply{}).Where("thread_id = ?", threadID).Count(&response.TotalRows).Error; err != nil {
		return nil, err
	}
	query := db.Unscoped().Where("thread_id = ?", threadID)
	if page.HasCursor {
		query = query.Where("(created_at,id) > (?,?)", page.Time, page.ID)
	}
	var replies []models.ForumReply
	if err := query.Preload("User", func(db *gorm.DB) *gorm.DB { return db.Select("id", "username", "call_sign") }).
		Order("created_at ASC,id ASC").Limit(page.Limit + 1).Find(&replies).Error; err != nil {
		return nil, err
	}
	if len(replies) > page.Limit {
		replies = replies[:page.Limit]
		cursor := common.EncodeReadCursor(replies[len(replies)-1].CreatedAt, replies[len(replies)-1].ID)
		response.NextCursor = &cursor
	}
	parentIDs := make([]uuid.UUID, 0, len(replies))
	for _, reply := range replies {
		if reply.ParentID != nil {
			parentIDs = append(parentIDs, *reply.ParentID)
		}
	}
	var parents []models.ForumReply
	if len(parentIDs) > 0 {
		if err := db.Unscoped().Select("id", "user_id", "deleted_at", "LEFT(body,160) AS body").
			Preload("User", func(db *gorm.DB) *gorm.DB { return db.Select("id", "username", "call_sign") }).
			Where("thread_id = ? AND id IN ?", threadID, parentIDs).Find(&parents).Error; err != nil {
			return nil, err
		}
	}
	parentContexts := make(map[uuid.UUID]*common.ForumParentContext, len(parents))
	for _, parent := range parents {
		parentContext := &common.ForumParentContext{IsDeleted: parent.DeletedAt.Valid}
		if !parentContext.IsDeleted {
			body := parent.Body
			parentContext.Body = &body
			parentContext.Author = forumAuthorResponse(parent.User)
		}
		parentContexts[parent.ID] = parentContext
	}
	response.Data = make([]common.ForumReplyResponse, 0, len(replies))
	for _, reply := range replies {
		replyResponse := forumReplyDetail(&reply)
		if reply.ParentID != nil {
			replyResponse.ParentContext = parentContexts[*reply.ParentID]
		}
		response.Data = append(response.Data, replyResponse)
	}
	return response, nil
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
		err := h.DB.Where("id = ? AND thread_id = ?", *input.ParentID, thread.ID).Take(&parent).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeReplyNotFound, "Parent reply not found in this thread"))
			return
		}
		if err != nil {
			slog.Error("Failed to query parent reply", "thread_id", thread.ID, "parent_id", *input.ParentID, "err", err)
			c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumQueryFailed, "Failed to query parent reply"))
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
	err = h.DB.Take(&reply, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, common.NewErrorResponse(common.ErrorCodeReplyNotFound, "Reply not found"))
		return
	}
	if err != nil {
		slog.Error("Failed to query forum reply", "reply_id", id, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeForumQueryFailed, "Failed to query forum reply"))
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
	response := common.ForumReplyResponse{
		ID:        reply.ID,
		ParentID:  reply.ParentID,
		Body:      &body,
		Author:    forumAuthorResponse(reply.User),
		IsDeleted: reply.DeletedAt.Valid,
		CreatedAt: reply.CreatedAt,
		Children:  []common.ForumReplyResponse{},
	}
	if response.IsDeleted {
		response.Body = nil
		response.Author = nil
	}
	return response
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
