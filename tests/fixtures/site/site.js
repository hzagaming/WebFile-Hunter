document.querySelector("#load-audio")?.addEventListener("click", () => {
  void fetch("/files/example.mp3").then((response) => response.arrayBuffer());
});
document.querySelector("#load-api")?.addEventListener("click", () => {
  void fetch("/api/download?id=1").then((response) => response.arrayBuffer());
});

const temporaryAudio = document.createElement("audio");
temporaryAudio.src = URL.createObjectURL(new Blob(["test"], { type: "audio/mpeg" }));
temporaryAudio.dataset.testResource = "blob-audio";
document.body.append(temporaryAudio);

const resourceHost = document.createElement("div");
resourceHost.id = "resource-shadow-host";
resourceHost.attachShadow({ mode: "open" }).innerHTML =
  '<p>开放 Shadow 正文</p><video preload="none" src="/files/shadow-video.mp4"></video>';
document.body.append(resourceHost);

const lateShadowHost = document.createElement("div");
lateShadowHost.id = "late-shadow-host";
document.body.append(lateShadowHost);
