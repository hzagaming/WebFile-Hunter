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
