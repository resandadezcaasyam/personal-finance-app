"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, setActiveProfile } from "@/lib/db/client";

const schema = z.object({ profile: z.enum(["personal", "demo"]) });

export async function switchProfile(formData: FormData) {
  const { profile } = schema.parse({ profile: formData.get("profile") });
  getDb(profile); // creates and migrates (and seeds demo.db on first use); never touches the other profile
  setActiveProfile(profile);
  revalidatePath("/", "layout");
}
