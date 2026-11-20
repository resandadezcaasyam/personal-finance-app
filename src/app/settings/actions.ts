"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, setActiveProfile } from "@/lib/db/client";
import { assertSession } from "@/lib/auth/guard";

const schema = z.object({ profile: z.enum(["personal", "demo"]) });

export async function switchProfile(formData: FormData) {
  assertSession(); // switching profiles must never be a way around the PIN
  const { profile } = schema.parse({ profile: formData.get("profile") });
  getDb(profile); // creates and migrates (and seeds demo.db on first use); never touches the other profile
  setActiveProfile(profile);
  revalidatePath("/", "layout");
}
