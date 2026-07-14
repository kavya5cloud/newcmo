/** Client-side web push subscription helpers. */

export type PushStatus = {
  configured: boolean;
  publicKey: string;
  subscribed: boolean;
  prefs: {
    enabled: boolean;
    timezone: string;
    channels: string[];
    quietStart: number;
    quietEnd: number;
    gscSite?: string | null;
  };
};

export async function fetchPushStatus(): Promise<PushStatus | null> {
  try {
    const r = await fetch("/api/push/subscribe");
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function subscribePush(publicKey: string): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return false;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const r = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...sub.toJSON(), timezone: tz }),
  });
  return r.ok;
}

export async function unsubscribePush(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    return true;
  } catch {
    return false;
  }
}

export async function updatePushPrefs(prefs: Partial<PushStatus["prefs"]>) {
  const r = await fetch("/api/push/subscribe", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
  return r.ok ? r.json() : null;
}
