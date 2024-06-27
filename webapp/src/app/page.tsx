"use client"
import { useEffect, useState } from "react";

export default function Home() {
  const [text, setText] = useState("")
  useEffect(() => {
    fetch("/api").then(res => res.json()).then((data: { text: string }) => {
      setText(data.text)
    })
  })
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <pre>
        {text}
      </pre>
    </main>
  );
}
