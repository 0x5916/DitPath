package common

import "errors"

var ErrExpiredToken = errors.New("expired")
var ErrInvalidToken = errors.New("invalid")

const (
	ErrorCodeInvalidRequestBody      = "INVALID_REQUEST_BODY"
	ErrorCodeInternalServerError     = "INTERNAL_SERVER_ERROR"
	ErrorCodeDatabaseFailure         = "DATABASE_FAILURE"
	ErrorCodeInvalidCredentials      = "INVALID_CREDENTIALS"
	ErrorCodeConflict                = "CONFLICT"
	ErrorCodeInvalidToken            = "INVALID_TOKEN"
	ErrorCodeExpiredToken            = "EXPIRED_TOKEN"
	ErrorCodeAuthHeaderRequired      = "AUTH_HEADER_REQUIRED"
	ErrorCodeInvalidAuthHeaderFormat = "INVALID_AUTH_HEADER_FORMAT"
	ErrorCodeUserNotFound            = "USER_NOT_FOUND"
	ErrorCodeSettingsFetchFailed     = "SETTINGS_FETCH_FAILED"
	ErrorCodeSettingsUpdateFailed    = "SETTINGS_UPDATE_FAILED"
	ErrorCodeProgressQueryFailed     = "PROGRESS_QUERY_FAILED"
	ErrorCodeProgressCreateFailed    = "PROGRESS_CREATE_FAILED"
	ErrorCodePasswordHashFailed      = "PASSWORD_HASH_FAILED"
	ErrorCodeTokenIssueFailed        = "TOKEN_ISSUE_FAILED"
	ErrorCodeEmailAlreadyInUse       = "EMAIL_ALREADY_IN_USE"
	ErrorCodeEmailVerifiedByAnother  = "EMAIL_VERIFIED_BY_ANOTHER_ACCOUNT"
	ErrorCodeUsernameAlreadyInUse    = "USERNAME_ALREADY_IN_USE"
	ErrorCodeEmailUnchanged          = "EMAIL_UNCHANGED"
	ErrorCodeEmailAlreadyVerified    = "EMAIL_ALREADY_VERIFIED"
	ErrorCodeVerificationCodeInvalid = "VERIFICATION_CODE_INVALID"
	ErrorCodeVerificationCodeExpired = "VERIFICATION_CODE_EXPIRED"
	ErrorCodeVerificationSendFailed  = "VERIFICATION_SEND_FAILED"
	ErrorCodeVerificationRateLimited = "VERIFICATION_RATE_LIMITED"
	ErrorCodeCallSignAlreadyInUse    = "CALL_SIGN_ALREADY_IN_USE"
	ErrorCodeEmailNotVerified        = "EMAIL_NOT_VERIFIED"
	ErrorCodeThreadNotFound          = "THREAD_NOT_FOUND"
	ErrorCodeReplyNotFound           = "REPLY_NOT_FOUND"
	ErrorCodeNotAuthor               = "NOT_AUTHOR"
	ErrorCodeInvalidQueryParameter   = "INVALID_QUERY_PARAMETER"
	ErrorCodeForumQueryFailed        = "FORUM_QUERY_FAILED"
	ErrorCodeForumCreateFailed       = "FORUM_CREATE_FAILED"
	ErrorCodeForumDeleteFailed       = "FORUM_DELETE_FAILED"
	ErrorCodeForumRateLimited        = "FORUM_RATE_LIMITED"
	ErrorCodeTrainingBatchTooLarge   = "TRAINING_BATCH_TOO_LARGE"
	ErrorCodeTrainingPayloadTooLarge = "TRAINING_PAYLOAD_TOO_LARGE"
	ErrorCodeTrainingSchemaVersion   = "TRAINING_UNSUPPORTED_SCHEMA_VERSION"
	ErrorCodeTrainingIngestFailed    = "TRAINING_INGEST_FAILED"
	ErrorCodeTrainingSnapshotFailed  = "TRAINING_SNAPSHOT_FAILED"
	ErrorCodeTrainingSettingsFailed  = "TRAINING_SETTINGS_UPDATE_FAILED"
)

// Per-event rejection codes reported in TrainingEventBatchResponse.RejectedEvents.
const (
	RejectCodeMissingField          = "MISSING_FIELD"
	RejectCodeInvalidField          = "INVALID_FIELD"
	RejectCodeInvalidTiming         = "INVALID_TIMING"
	RejectCodeInvalidClassification = "INVALID_CLASSIFICATION"
	RejectCodeInvalidPromptKind     = "INVALID_PROMPT_KIND"
	RejectCodeInvalidInputMode      = "INVALID_INPUT_MODE"
)

func NewErrorResponse(code string, message string) ErrorResponse {
	return ErrorResponse{Code: code, Error: message}
}
