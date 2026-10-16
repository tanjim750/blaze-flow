import { SignInForm } from "./form";

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function SignIn({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  return (
    <SignInForm
      next={one(params.next)}
      signedOut={one(params.signed_out) === "1"}
      email={one(params.email)}
    />
  );
}
