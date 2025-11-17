  import React, { useState, useEffect, useRef, useCallback } from "react";
  import { io } from "socket.io-client";

  const SAMPLE_RATE = 24000;

  const RealtimeVoiceChat: React.FC = () => {
    const [messages, setMessages] = useState<
      { from: "user" | "bot"; text: string }[]
    >([]);
    const [input, setInput] = useState("");
    const [connected, setConnected] = useState(false);
    const [recording, setRecording] = useState(false);

    const socketRef = useRef<any>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const queueRef = useRef<Float32Array[]>([]);
    const isPlayingRef = useRef(false);
    const [conversationId,setConversationId]= useState(null)

    // 🔊 Play queued PCM chunks using Web Audio API
    const playNextChunk = useCallback(async () => {
      if (isPlayingRef.current) return;
      if (!audioCtxRef.current || queueRef.current.length === 0) return;

      const ctx = audioCtxRef.current;
      isPlayingRef.current = true;

      while (queueRef.current.length > 0) {
        const chunk = queueRef.current.shift();
        if (!chunk) continue;

        const buffer = ctx.createBuffer(1, chunk.length, SAMPLE_RATE);
        buffer.copyToChannel(chunk, 0);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        const duration = buffer.duration * 1000;
        source.start();
        await new Promise((r) => setTimeout(r, duration));
      }

      isPlayingRef.current = false;
    }, []);

    //http://148.230.104.35:4050

    useEffect(() => {
      const socket = io("http://localhost:4050", {
        transports: ["websocket"],
        query: {
          userId: "68d6eaf2e30a9a7097c6202c",
        },
      });
      socketRef.current = socket;

      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioContextClass({ sampleRate: SAMPLE_RATE });

      socket.on("connect", () => {
        setConnected(true);
      });

      socket.on("userTranscript", (d: any) =>
        setMessages((m) => [...m, { from: "user", text: d.transcript, }])
      );

      // Temporary buffer to accumulate bot text
      let botTextBuffer = "";

      socket.on("textChunk", (d: any) => {
        // Append incoming chunk to buffer
        botTextBuffer += d.text;

        setMessages((prevMessages) => {
          const msgs = [...prevMessages];
          const last = msgs[msgs.length - 1];

          // If last message is from bot, update it
          if (last?.from === "bot") {
            last.text = botTextBuffer;
          } else {
            // Otherwise, push new message with current buffer
            msgs.push({ from: "bot", text: botTextBuffer });
          }

          return msgs;
        });
      });

      socket.on("responseDone", (data) => {
        // const {conversationId,textBuffer}= data
        botTextBuffer = data.textBuffer; 
        setConversationId(data.conversationId)
      });

      // 🎧 Handle PCM16 chunks
      socket.on("audioChunk", ({ audio, format, sampleRate }) => {
        if (format !== "pcm16") return;

        // Decode base64 PCM16 → Float32
        const binary = atob(audio);
        const buffer = new ArrayBuffer(binary.length);
        const view = new Uint8Array(buffer);
        for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);

        const pcm = new Int16Array(buffer);
        const float32 = new Float32Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) float32[i] = pcm[i] / 32768;

        queueRef.current.push(float32);
        playNextChunk();
      });

      socket.on("disconnect", () => setConnected(false));

      return () => socket.disconnect();
    }, [playNextChunk]);

    // 🎙️ Voice recording
    const startRecording = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mediaRecorderRef.current = rec;

      rec.ondataavailable = (e) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          socketRef.current?.emit("audioData", {
            userId: "68d6eaf2e30a9a7097c6202c",
            audio: reader.result,
          });
        };
        reader.readAsDataURL(e.data);
      };

      rec.start(100);
      setRecording(true);
    };

    const stopRecording = () => {
      mediaRecorderRef.current?.stop();
      setRecording(false);
    };

    // 💬 Send message
    const sendMessage = () => {
      if (!input.trim()) return;
      socketRef.current?.emit("sendText", {
        userId: "68d6eaf2e30a9a7097c6202c",
        text: input,
        conversationId
      });
      setMessages((m) => [...m, { from: "user", text: input }]);
      setInput("");
    };

    return (
      <div
        style={{
          maxWidth: 600,
          margin: "20px auto",
          fontFamily: "sans-serif",
          color: "#fff",
        }}
      >
        <h2>🎧 Realtime Voice Chat (PCM16)</h2>
        <p>Status: {connected ? "🟢 Connected" : "🔴 Disconnected"}</p>

        <div
          style={{
            background: "#222",
            borderRadius: 10,
            padding: 10,
            height: 300,
            overflowY: "auto",
            marginBottom: 10,
          }}
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                textAlign: msg.from === "user" ? "right" : "left",
                margin: "4px 0",
              }}
            >
              <b>{msg.from === "user" ? "You: " : "Bot: "}</b>
              <span style={{ whiteSpace: "pre-wrap" }}>{msg.text}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={!connected}
          >
            {recording ? "🛑 Stop" : "🎙️ Record"}
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Type message..."
            style={{ flex: 1, padding: 6 }}
          />
          <button onClick={sendMessage} disabled={!connected}>
            Send
          </button>
        </div>
      </div>
    );
  };

  export default RealtimeVoiceChat;
