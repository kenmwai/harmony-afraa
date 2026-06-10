import { supabase } from "@/integrations/supabase/client";

export async function uploadPdf(file: File, kind: "flightplan" | "amendment", uprId: string): Promise<{ path: string; name: string; size: number }> {
  if (file.type !== "application/pdf") throw new Error("PDF only");
  if (file.size > 10 * 1024 * 1024) throw new Error("Max 10 MB");
  const ext = file.name.split(".").pop() ?? "pdf";
  const path = `${uprId}/${kind}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("upr-attachments").upload(path, file, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) throw error;
  return { path, name: file.name, size: file.size };
}

export async function getSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("upr-attachments").createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}
