function copylink(path, button) {
  let url = new URL(
    path,
    document.location.protocol + "//" + document.location.host
  );
  let str = url.toString();

  navigator.clipboard.writeText(str).then(
    function () {
      console.log("Copied");
      let originalText = button.innerText;
      button.innerText = "Copied ✓";
      setTimeout(function () {
        button.innerText = originalText;
      }, 2000);
    },
    function () {
      console.error("Copy failed");
      let node = document.createElement("small");
      node.innerText = "Copy failed. Try this: ";
      let innerNode = document.createElement("pre");
      innerNode.innerText = str;
      node.appendChild(innerNode);
      button.parentNode.appendChild(node);
      button.parentNode.removeChild(button);
    }
  );
}

async function deleteFrame(link, button) {
  button.innerText = "Deleting...";
  let res = await fetch(link, { method: "DELETE" });
  if (res.ok) {
    let parent = button.parentElement;
    let list = parent.parentElement;
    list.removeChild(parent);
  } else {
    button.innerText = "Error";
  }
}

document.body.addEventListener("click", (event) => {
  if (event.target.className === "copy-button") {
    let link = event.target.getAttribute("data-link");
    copylink(link, event.target);
  }

  if (event.target.className === "delete-button") {
    let confirmed = confirm(
      "Are you sure you want to permanently delete this frame?"
    );
    if (confirmed) {
      let link = event.target.getAttribute("data-link");
      deleteFrame(link, event.target);
    }
  }
});
