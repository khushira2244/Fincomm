import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      // The v3 schema's `users` table requires `name` and `authId` (see
      // convex/schema.ts) — fields the default Password profile doesn't
      // set. This is the Password provider's own profile hook, not a
      // schema change: it only fills in what the approved schema already
      // requires. `authId` mirrors the Password provider's own account
      // key (email) since there's no other stable pre-signup identifier.
      profile(params) {
        const email = params.email as string;
        const name = typeof params.name === "string" && params.name.length > 0 ? params.name : email;
        return { email, name, authId: email };
      },
    }),
  ],
});
