// ponytail: simple fetch, no retry, no rate limit handling.
// Upgrade: add retries + rate limit tracking when X API usage increases.

const X_BASE = "https://api.twitter.com/2";

interface XProfileResult {
  bio: string;
  recentPosts: string[];
}

export async function fetchXProfile(handle: string): Promise<XProfileResult | null> {
  const token = process.env.X_API_KEY;
  if (!token) return null;

  try {
    const userRes = await fetch(`${X_BASE}/users/by/username/${handle}?user.fields=description`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) return null;

    const userData = await userRes.json() as { data?: { id: string; description?: string } };
    const userId = userData.data?.id;
    const bio = userData.data?.description ?? "";
    if (!userId) return null;

    const tweetsRes = await fetch(
      `${X_BASE}/users/${userId}/tweets?max_results=10&tweet.fields=text`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!tweetsRes.ok) return { bio, recentPosts: [] };

    const tweetsData = await tweetsRes.json() as { data?: Array<{ text: string }> };
    const recentPosts = (tweetsData.data ?? []).map((t) => t.text);

    return { bio, recentPosts };
  } catch {
    return null;
  }
}
