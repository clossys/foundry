import { AuthView, SignInForm, type SignInFormProps } from "@clossys/publisher/web";
import {
  resolveFrontDoorCopy,
  type FrontDoorKey,
} from "@clossys/writer";

// The host supplies these handlers and the provider availability state.
const identify: SignInFormProps["identify"] = async () => ({ status: "ok" });
const verify: SignInFormProps["verify"] = async () => ({ status: "ok" });
const goHome: SignInFormProps["onSignedIn"] = () => {};
const unavailable: boolean = false;

const nouns = { surface: "Acme Console" };
function copy(id: FrontDoorKey) {
  const result = resolveFrontDoorCopy(id, nouns);
  if (!result.complete) throw new Error("Front-door copy is unavailable.");
  return result.text;
}

// Render inside the layout's SiteFrame; handlers belong to the host.
const signIn = <AuthView
  heading={copy("front-door.sign-in.title")}
  description={copy("front-door.sign-in-invite-only.description")}
  form={<SignInForm access="invite-only" nouns={nouns}
    identify={identify} verify={verify} onSignedIn={goHome}
    unavailable={unavailable} />}
/>;


export default function Example() { return signIn; }
