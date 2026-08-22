package app

import (
	"context"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/hybrid"
)

func (a *App) dispatchHybrid(parent context.Context, kind string, input, output any) error {
	if !a.Hybrid.Enabled() {
		return hybrid.ErrWorkerUnavailable
	}
	lease := a.Config.HybridJobLease
	if lease <= 0 {
		lease = 20 * time.Second
	}
	ctx, cancel := context.WithTimeout(parent, lease)
	defer cancel()
	return a.Hybrid.Dispatch(ctx, kind, input, output)
}

func (a *App) youtubeMetadata(ctx context.Context, input string) (string, string, error) {
	var result hybrid.YouTubeMetadataResult
	if err := a.dispatchHybrid(ctx, hybrid.KindYouTubeMetadata, hybrid.YouTubeInput{Input: input}, &result); err == nil {
		return result.Title, result.VideoID, nil
	}
	return a.YouTube.Metadata(ctx, input)
}
