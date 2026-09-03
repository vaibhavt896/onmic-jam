/**
 * The reel rail on the landing page.
 *
 * "Content is the interface" — the reels do the persuading, because a room that
 * looks full is the only proof that matters. 9:16, because that is the shape the
 * footage is already shot in.
 *
 * Empty by default and on purpose: six empty boxes persuade nobody, so the rail
 * renders nothing until there is something real to put in it. Drop poster frames
 * into /public/reels and list them here — build note 06 is why it is a poster
 * image and a link rather than six autoplaying videos on Kanpur mobile data.
 *
 *   { poster: "/reels/jam-01.jpg", href: "https://instagram.com/reel/…",
 *     views: "14.2K" }
 */
export type Reel = {
  /** a poster frame in /public — never a <video> that autoplays */
  poster: string;
  /** where tapping it goes: the reel on Instagram */
  href: string;
  /** optional view count, rendered small over the bottom of the tile */
  views?: string;
};

export const REELS: Reel[] = [];
