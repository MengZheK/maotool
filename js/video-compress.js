(() => {
  const PRESETS = {
    near: { crf: "18", bpp: 0.15, quantizer: 16, label: "几乎无损" },
    high: { crf: "23", bpp: 0.1, quantizer: 23, label: "高画质" },
    small: { crf: "28", bpp: 0.07, quantizer: 30, label: "更小体积" },
  };

  const els = {
    drop: document.getElementById("videoDrop"),
    input: document.getElementById("videoInput"),
    fileTag: document.getElementById("videoFileTag"),
    probe: document.getElementById("videoProbe"),
    warn: document.getElementById("videoWarn"),
    startBtn: document.getElementById("videoStartBtn"),
    clearBtn: document.getElementById("videoClearBtn"),
    progressPanel: document.getElementById("videoProgressPanel"),
    engineHint: document.getElementById("videoEngineHint"),
    progressBar: document.getElementById("videoProgressBar"),
    progressText: document.getElementById("videoProgressText"),
    resultPanel: document.getElementById("videoResultPanel"),
    resultHint: document.getElementById("videoResultHint"),
    resultStats: document.getElementById("videoResultStats"),
    downloadBtn: document.getElementById("videoDownloadBtn"),
  };

  if (!els.drop || !els.input) return;

  let file = null;
  let meta = null;
  let quality = "high";
  let outputBlob = null;
  let ffmpegSingleton = null;

  const qualityBtns = document.querySelectorAll(".video-quality-row .preset-btn");

  qualityBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      quality = btn.dataset.quality;
      qualityBtns.forEach((b) => b.classList.toggle("active", b === btn));
      if (meta) renderProbe(meta);
    });
  });

  els.drop.addEventListener("click", () => els.input.click());
  els.input.addEventListener("change", (e) => {
    if (e.target.files[0]) setFile(e.target.files[0]);
  });
  ["dragenter", "dragover"].forEach((evt) => {
    els.drop.addEventListener(evt, (e) => {
      e.preventDefault();
      els.drop.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    els.drop.addEventListener(evt, (e) => {
      e.preventDefault();
      els.drop.classList.remove("dragover");
    });
  });
  els.drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("video/")) setFile(f);
  });

  els.clearBtn.addEventListener("click", resetAll);
  els.startBtn.addEventListener("click", startCompress);
  els.downloadBtn.addEventListener("click", downloadOutput);

  function resetAll() {
    file = null;
    meta = null;
    outputBlob = null;
    els.input.value = "";
    els.fileTag.innerHTML = "";
    els.probe.hidden = true;
    els.warn.hidden = true;
    els.startBtn.disabled = true;
    els.progressPanel.hidden = true;
    els.resultPanel.hidden = true;
    setProgress(0, "准备中");
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function formatDuration(sec) {
    if (!Number.isFinite(sec)) return "—";
    const s = Math.round(sec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m} 分 ${r} 秒` : `${r} 秒`;
  }

  function even(n) {
    return Math.max(2, n - (n % 2));
  }

  function targetBitrate(width, height, fps, bpp) {
    return Math.round(width * height * fps * bpp);
  }

  function pickAvcCodec(width, height) {
    const pixels = width * height;
    if (pixels > 2073600) return "avc1.640033";
    if (pixels > 921600) return "avc1.640028";
    return "avc1.64001f";
  }

  function setProgress(ratio, hint) {
    const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    els.progressBar.style.width = `${pct}%`;
    els.progressText.textContent = `${pct}%`;
    if (hint) els.engineHint.textContent = hint;
  }

  function waitEvent(el, name) {
    return new Promise((resolve, reject) => {
      const ok = () => {
        el.removeEventListener(name, ok);
        el.removeEventListener("error", fail);
        resolve();
      };
      const fail = () => {
        el.removeEventListener(name, ok);
        el.removeEventListener("error", fail);
        reject(new Error("视频无法解析"));
      };
      el.addEventListener(name, ok);
      el.addEventListener("error", fail);
    });
  }

  async function probeFile(f) {
    const url = URL.createObjectURL(f);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    try {
      await waitEvent(video, "loadedmetadata");
      const duration = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;
      const fps = 30;
      const bitrate = duration > 0 ? (f.size * 8) / duration : 0;
      const hasAudio = Boolean(video.audioTracks?.length) || video.mozHasAudio !== false;
      return { duration, width, height, fps, bitrate, hasAudio, url, video };
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  }

  function renderProbe(info) {
    const preset = PRESETS[quality];
    const target = targetBitrate(info.width, info.height, info.fps, preset.bpp);
    els.probe.hidden = false;
    els.probe.innerHTML = `
      <div class="video-probe-item"><div class="num">${info.width}×${info.height}</div><div class="lbl">分辨率</div></div>
      <div class="video-probe-item"><div class="num">${formatDuration(info.duration)}</div><div class="lbl">时长</div></div>
      <div class="video-probe-item"><div class="num">${formatBytes(file.size)}</div><div class="lbl">源体积</div></div>
      <div class="video-probe-item"><div class="num">${(info.bitrate / 1e6).toFixed(1)} Mbps</div><div class="lbl">源码率</div></div>
    `;

    const oversized = file.size > 500 * 1024 * 1024 || info.duration > 600;
    const alreadyTight = info.bitrate > 0 && info.bitrate < target * 1.15;
    const notes = [];
    if (oversized) notes.push("文件较大或较长，浏览器可能内存不足，仍可尝试。");
    if (alreadyTight) notes.push("源码率已经较低，再压收益小，可能几乎不降体积或略伤画质。");
    notes.push(`当前档位「${preset.label}」：目标约 ${(target / 1e6).toFixed(1)} Mbps（CRF ${preset.crf}）。`);
    els.warn.hidden = false;
    els.warn.textContent = notes.join(" ");
  }

  async function setFile(f) {
    resetAll();
    file = f;
    els.fileTag.innerHTML = `<span class="file-tag">${f.name} · ${formatBytes(f.size)}</span>`;
    try {
      meta = await probeFile(f);
      renderProbe(meta);
      els.startBtn.disabled = false;
    } catch (err) {
      els.warn.hidden = false;
      els.warn.textContent = "无法读取该视频：" + err.message;
    }
  }

  function canUseWebCodecs() {
    return (
      typeof VideoEncoder === "function" &&
      typeof VideoFrame === "function" &&
      typeof HTMLVideoElement !== "undefined" &&
      typeof HTMLVideoElement.prototype.requestVideoFrameCallback === "function"
    );
  }

  async function loadMp4Muxer() {
    return import("https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm");
  }

  async function compressWebCodecs(f, info, preset, onProgress) {
    const width = even(info.width);
    const height = even(info.height);
    const fps = info.fps || 30;
    const bitrate = targetBitrate(width, height, fps, preset.bpp);
    const codec = pickAvcCodec(width, height);

    const baseConfig = {
      codec,
      width,
      height,
      framerate: fps,
      bitrate,
      latencyMode: "quality",
      hardwareAcceleration: "prefer-hardware",
      avc: { format: "avc" },
    };

    let useQuant = false;
    if (VideoEncoder.isConfigSupported) {
      const qCfg = { ...baseConfig, bitrateMode: "quantizer" };
      const support = await VideoEncoder.isConfigSupported(qCfg);
      useQuant = Boolean(support?.supported);
      if (!useQuant) {
        const vbr = await VideoEncoder.isConfigSupported({ ...baseConfig, bitrateMode: "variable" });
        if (!vbr?.supported) throw new Error("浏览器不支持当前分辨率的 H.264 编码");
      }
    }

    const muxerMod = await loadMp4Muxer();
    const Muxer = muxerMod.Muxer;
    const ArrayBufferTarget = muxerMod.ArrayBufferTarget;
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: "avc", width, height },
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });

    const encoder = new VideoEncoder({
      output: (chunk, metaOut) => muxer.addVideoChunk(chunk, metaOut),
      error: (err) => {
        throw err;
      },
    });
    encoder.configure(
      useQuant ? { ...baseConfig, bitrateMode: "quantizer" } : { ...baseConfig, bitrateMode: "variable" }
    );

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = URL.createObjectURL(f);
    await waitEvent(video, "loadeddata");

    let frameIndex = 0;
    const gop = Math.max(16, Math.round(fps * 2));
    let lastMediaTime = -1;
    let stalled = 0;

    await video.play();

    await new Promise((resolve, reject) => {
      const finish = async () => {
        try {
          await encoder.flush();
          muxer.finalize();
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      const onFrame = (now, metadata) => {
        try {
          if (Math.abs(metadata.mediaTime - lastMediaTime) < 1e-4) {
            stalled += 1;
          } else {
            stalled = 0;
            lastMediaTime = metadata.mediaTime;
          }

          const timestamp = Math.round(metadata.mediaTime * 1_000_000);
          const frame = new VideoFrame(video, { timestamp, alpha: "discard" });
          const opts = { keyFrame: frameIndex % gop === 0 };
          if (useQuant) opts.avc = { quantizer: preset.quantizer };
          encoder.encode(frame, opts);
          frame.close();
          frameIndex += 1;
          onProgress(Math.min(0.98, metadata.mediaTime / Math.max(info.duration, 0.001)), "WebCodecs 硬件编码中");

          if (video.ended || metadata.mediaTime >= info.duration - 0.04 || stalled > 12) {
            finish();
            return;
          }
          video.requestVideoFrameCallback(onFrame);
        } catch (err) {
          reject(err);
        }
      };

      video.requestVideoFrameCallback(onFrame);
      video.addEventListener("ended", () => finish(), { once: true });
    });

    URL.revokeObjectURL(video.src);
    if (frameIndex < 2) throw new Error("抽帧过少，改用兼容编码器");
    return new Blob([target.buffer], { type: "video/mp4" });
  }

  async function loadFfmpeg(onProgress) {
    if (ffmpegSingleton) return ffmpegSingleton;
    onProgress(0.02, "正在加载 FFmpeg 引擎（首次约 25MB，仅本机）");
    const { FFmpeg } = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm");
    const { toBlobURL } = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/+esm");
    const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
    const ffmpeg = new FFmpeg();
    ffmpeg.on("progress", ({ progress }) => {
      if (typeof progress === "number") onProgress(0.08 + progress * 0.9, "x264 CRF 重编码中");
    });
    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegSingleton = ffmpeg;
    return ffmpeg;
  }

  async function compressFfmpeg(f, preset, onProgress) {
    const ffmpeg = await loadFfmpeg(onProgress);
    const { fetchFile } = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/+esm");
    const ext = (f.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
    const inputName = `input.${ext}`;
    await ffmpeg.writeFile(inputName, await fetchFile(f));
    onProgress(0.08, `x264 CRF ${preset.crf} 重编码中`);
    await ffmpeg.exec([
      "-y",
      "-i",
      inputName,
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v",
      "libx264",
      "-crf",
      preset.crf,
      "-preset",
      "fast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "output.mp4",
    ]);
    const data = await ffmpeg.readFile("output.mp4");
    try {
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile("output.mp4");
    } catch (_) {
      /* ignore */
    }
    const bytes = data.buffer ? data : new Uint8Array(data);
    return new Blob([bytes], { type: "video/mp4" });
  }

  async function startCompress() {
    if (!file || !meta) return;
    const preset = PRESETS[quality];
    outputBlob = null;
    els.resultPanel.hidden = true;
    els.progressPanel.hidden = false;
    els.startBtn.disabled = true;
    setProgress(0, "开始处理");

    try {
      let blob = null;
      const hasAudioApi = typeof meta.video?.audioTracks === "undefined" || (meta.video.audioTracks?.length || 0) > 0;
      const preferWc = canUseWebCodecs() && !hasAudioApi;

      if (canUseWebCodecs() && (preferWc || !hasAudioApi)) {
        try {
          setProgress(0.04, "使用 WebCodecs 硬件编码");
          blob = await compressWebCodecs(file, meta, preset, setProgress);
        } catch (err) {
          console.warn("WebCodecs failed, fallback ffmpeg", err);
          setProgress(0.02, "硬件编码不可用，改用 FFmpeg");
          blob = await compressFfmpeg(file, preset, setProgress);
        }
      } else if (canUseWebCodecs()) {
        // 有音轨时优先 FFmpeg，保证音画同步；WebCodecs 仅作失败后不再重试
        try {
          setProgress(0.02, "使用 FFmpeg（保留音轨）");
          blob = await compressFfmpeg(file, preset, setProgress);
        } catch (err) {
          console.warn("ffmpeg failed, try WebCodecs video-only", err);
          setProgress(0.04, "FFmpeg 失败，尝试无音轨硬件编码");
          blob = await compressWebCodecs(file, meta, preset, setProgress);
        }
      } else {
        blob = await compressFfmpeg(file, preset, setProgress);
      }

      outputBlob = blob;
      setProgress(1, "完成");
      renderResult(blob, preset);
    } catch (err) {
      els.warn.hidden = false;
      els.warn.textContent = "压缩失败：" + err.message;
      setProgress(0, "失败");
    } finally {
      els.startBtn.disabled = !file;
    }
  }

  function renderResult(blob, preset) {
    els.resultPanel.hidden = false;
    const saved = file.size - blob.size;
    const ratio = file.size > 0 ? (saved / file.size) * 100 : 0;
    const smaller = blob.size < file.size;
    els.resultHint.textContent = smaller
      ? `「${preset.label}」完成，体积下降 ${ratio.toFixed(1)}%`
      : `「${preset.label}」完成，体积未下降（源可能已经很省）`;
    els.resultStats.innerHTML = `
      <div class="stat"><div class="value">${formatBytes(file.size)}</div><div class="label">压缩前</div></div>
      <div class="stat"><div class="value">${formatBytes(blob.size)}</div><div class="label">压缩后</div></div>
      <div class="stat"><div class="value" style="color:${smaller ? "var(--accent-deep)" : "var(--warn)"}">${
      smaller ? "-" : "+"
    }${formatBytes(Math.abs(saved))}</div><div class="label">变化</div></div>
      <div class="stat"><div class="value">${Math.abs(ratio).toFixed(1)}%</div><div class="label">${
      smaller ? "缩小" : "变化"
    }</div></div>
    `;
  }

  function downloadOutput() {
    if (!outputBlob) return;
    const base = (file?.name || "video").replace(/\.[^.]+$/, "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(outputBlob);
    a.download = `${base}_compressed.mp4`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
})();
