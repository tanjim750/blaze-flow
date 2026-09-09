"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Flame, LockKeyhole, Mail } from "lucide-react";
import { FormEvent, useState } from "react";

export default function SignIn(){
  const [show,setShow]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const router=useRouter();
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError("");const data=new FormData(e.currentTarget);
    try{const response=await fetch("/api/auth/login/",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({email:data.get("email"),password:data.get("password")})});if(!response.ok){const body=await response.json().catch(()=>null);throw new Error(body?.detail??body?.non_field_errors?.[0]??"Unable to sign in.")}router.push("/");router.refresh()}
    catch(reason){setError(reason instanceof Error?reason.message:"Unable to sign in.")}finally{setBusy(false)}
  }
  return <main className="auth-page"><section className="auth-story"><Link className="auth-brand" href="/"><span><Flame/></span>Blaze Flow</Link><div><p className="eyebrow">Creative work, in one place</p><h1>Move from first draft to final approval with clarity.</h1><p>Manage projects, feedback, files and delivery without losing the thread.</p></div><small>Built for creative teams and their clients.</small></section><section className="auth-form-wrap"><form className="auth-form" onSubmit={submit}><div><p className="eyebrow">Welcome back</p><h2>Sign in to your workspace</h2><p className="muted">Use your work email to continue.</p></div><button className="google" type="button"><b>G</b> Continue with Google</button><div className="divider"><span>or</span></div><label>Email address<div className="field"><Mail/><input name="email" type="email" placeholder="you@company.com" autoComplete="email" required/></div></label><label>Password <Link href="#">Forgot password?</Link><div className="field"><LockKeyhole/><input name="password" type={show?"text":"password"} placeholder="Enter your password" autoComplete="current-password" required/><button type="button" onClick={()=>setShow(!show)} aria-label="Show password"><Eye/></button></div></label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button primary submit" disabled={busy}>{busy?"Signing in…":"Sign in"}</button><p className="form-foot">New to Blaze Flow? <Link href="#">Create an account</Link></p></form></section></main>
}
