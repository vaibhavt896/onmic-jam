import { REELS } from "@/lib/reels";

/**
 * 9:16, horizontal snap, no arrows and no dots — the audience has swiped a
 * thousand of these. Framed by nothing: no captions over images, no card chrome,
 * no titles competing with the footage.
 *
 * Poster frame only, loaded lazily; tapping opens the reel on Instagram. Six
 * autoplaying videos is the fastest way to lose a visitor on mobile data.
 *
 * Renders nothing until there are real reels to show — see src/lib/reels.ts.
 */
export function ReelRail() {
  if (REELS.length === 0) return null;

  return (
    <div className="rail -mx-5 px-5 pb-2" data-testid="reel-rail">
      {REELS.map((reel) => (
        <a
          key={reel.href}
          href={reel.href}
          target="_blank"
          rel="noreferrer"
          className="reel press flex items-end p-3"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={reel.poster}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {reel.views && (
            <span className="mono relative text-text-2 drop-shadow">{reel.views}</span>
          )}
        </a>
      ))}
    </div>
  );
}
