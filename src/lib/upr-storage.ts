import { supabase } from "@/integrations/supabase/client";

export async function uploadPdf(
  file: File,
  kind: "flightplan" | "amendment",
  uprId: string,
): Promise<{ path: string; name: string; size: number }> {
  if (file.type !== "application/pdf") throw new Error("PDF only");
  if (file.size > 10 * 1024 * 1024) throw new Error("Max 10 MB");
  const ext = file.name.split(".").pop() ?? "pdf";
  const path = `${uprId}/${kind}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("upr-attachments")
    .upload(path, file, { contentType: "application/pdf", upsert: false });
  if (error) {
    console.error("[uploadPdf]", error);
    throw new Error(error.message || "Upload failed");
  }
  return { path, name: file.name, size: file.size };
}

export async function getSignedUrl(path: string, filename?: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("upr-attachments")
    .createSignedUrl(path, 60 * 10, filename ? { download: filename } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Fetch the PDF as a blob and trigger a click on a hidden anchor.
 * Avoids popup-blocker issues that affect window.open() after an await.
 */
async function fetchBlob(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from("upr-attachments").download(path);
  if (error) throw error;
  return data;
}

export async function downloadPdf(path: string, filename: string): Promise<void> {
  const blob = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "flightplan.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function viewPdf(path: string): Promise<void> {
  const blob = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
