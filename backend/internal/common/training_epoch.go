package common

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

const TrainingEpochHeader = "X-Training-Epoch"

var errStaleTrainingEpoch = errors.New("training generation has changed")

// Call while holding the corresponding sync-state lock. Pre-generation clients
// can continue uploading until the account explicitly resets its progress.
func CheckTrainingEpoch(c *gin.Context, current int) error {
	value := strconv.Itoa(current)
	c.Header(TrainingEpochHeader, value)
	values := c.Request.Header.Values(TrainingEpochHeader)
	if len(values) == 0 && current == 1 || len(values) == 1 && values[0] == value {
		return nil
	}
	return errStaleTrainingEpoch
}

func RespondStaleTrainingEpoch(c *gin.Context, err error) bool {
	if !errors.Is(err, errStaleTrainingEpoch) {
		return false
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusConflict, NewErrorResponse("TRAINING_EPOCH_CHANGED", "Learning progress has been reset. Reload the current history."))
	return true
}
