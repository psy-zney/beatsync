package realtime

import (
	"testing"
	"time"
)

func TestNTPRateLimiterAllowsProbePairAndCapsBurst(t *testing.T) {
	t.Parallel()
	client := NewClient("room", "client", "Alice", false, nil)
	start := client.ntpLastRefill

	for request := 0; request < int(ntpTokenCapacity); request++ {
		if !client.AllowNTP(start) {
			t.Fatalf("request %d was rejected inside burst capacity", request+1)
		}
	}
	if client.AllowNTP(start) {
		t.Fatal("request above burst capacity was accepted")
	}

	// Four tokens/second means half a second restores one complete pair.
	refilledAt := start.Add(500 * time.Millisecond)
	if !client.AllowNTP(refilledAt) || !client.AllowNTP(refilledAt) {
		t.Fatal("a probe pair was not restored after token refill")
	}
	if client.AllowNTP(refilledAt) {
		t.Fatal("refill created more tokens than expected")
	}
}
