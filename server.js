require("dotenv").config();
let MemoryStore = require("memorystore");
let Steam = require("openid-steam");
let _nanoid = require("nanoid");
let express = require("express");
let fetch = require("node-fetch");
let formidable = require("formidable");
let fs = require("fs").promises;
let im = require("imagemagick");
let jsonfile = require("jsonfile");
let mkdirp = require("mkdirp");
let path = require("path");
let pino = require("express-pino-logger");
let session = require("express-session");

let alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
let nanoid = _nanoid.customAlphabet(alphabet, 14);

let IMG_DIR =
  process.env.NODE_ENV === "production" ? "/var/data/images" : "./data/images";

// Ensure the img dir exists
mkdirp.sync(IMG_DIR);

let DOMAIN = process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";

let steam = new Steam(DOMAIN + "/auth");
let app = express();

app.use(pino());
app.set("trust proxy", 1); // trust first proxy
app.use(
  session({
    secret: process.env.SECRET || "keyboard-catto",
    resave: true,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 86400, // 24h in s
    },
    store: new MemoryStore({
      checkPeriod: 86400000, // 24h in ms
    }),
  })
);

function tpl(body) {
  return `
    <!doctype>
    <html>
      <head>
        <title>Custom Frames</title>
        <style>
          .frames {
            display: grid;
            justify-content: center;
            gap: 1rem;
            grid-template-columns: repeat(auto-fit, 200px);
          }
          .frame-container {
            width: 200px;
            text-align: center;
          }
          .frame-container small {
            display: block;
            margin-bottom: .25rem;
          }
        </style>
        <script>
          function copylink(path) {
            let url = new URL(path, document.location.protocol + "//" + document.location.host)
            navigator.clipboard.writeText(url.toString()).then(function() {
              console.log('Copied')
            }, function() {
              console.error('Copy failed')
            });
          }
        </script>
      </head>
      <body>
        ${body}
      </body>
    </html>
  `;
}

async function framesList() {
  let frames = await fs.readdir(IMG_DIR);
  frames = frames
    .map((filename) => {
      if (filename.endsWith(".json")) {
        let content = jsonfile.readFileSync(path.join(IMG_DIR, filename));
        let pngUrl = filename.replace(/.json$/, ".png");
        let ddsUrl = filename.replace(/.json$/, ".dds");
        return {
          steamId: content.steamId,
          personaname: content.personaname,
          profileurl: content.profileurl,
          png: pngUrl,
          dds: ddsUrl,
        };
      }
    })
    .filter(Boolean);
  return `
      <div class="frames">
        ${frames.map(
          (frame) =>
            `<div class="frame-container">
              <img height="200" src="/img/${frame.png}"/>
              <small>Uploaded by <a href="${frame.profileurl}">${frame.personaname}</a></small>
              <button onclick="copylink('/img/${frame.dds}')">Copy link</button>
            </div>`
        )}
      </div>
    `;
}

async function getSteamUser(steamId) {
  let res = await fetch(
    `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${process.env.STEAM_API_KEY}&steamids=${steamId}`
  );
  if (res.ok) {
    let data = await res.json();
    return data.response.players[0];
  }
  throw Error("No user");
}

async function signInPage(res) {
  let signInUrl = await steam.url();
  res.status(200).send(
    tpl(`
          <p>In order to upload you must <a href="${signInUrl}">sign in with Steam</a>.</p>
          <p>Your Steam name, id, and profile link are stored with your frames.</p>
          ${await framesList()}
      `)
  );
}

async function mainPage(req, res, status, content = {}) {
  let user = await getSteamUser(req.session.steamId);
  let { error, message } = content;

  res.status(status).send(
    tpl(`
      <p>Hello, <a href=${user.profileurl}>${
      user.personaname
    }</a>. <a href="/logout">Log out</a></p>
      <form action="/" method="POST" enctype="multipart/form-data">
        <p>Frames must be png files that are 600px high and 512px wide.</p>
        <p>Download the <a href="/template.png">template</a>.</p>
        ${message ? `<p class="message">${message}</p>` : ""}
        ${error ? `<p class="error">${error}</p>` : ""}
        <input type="file" name="image" />
        <button type="submit">upload</button>
      </form>
      ${await framesList()}
      `)
  );
}

app.get("/", async (req, res) => {
  if (req.session.steamId) {
    await mainPage(req, res, 200);
  } else {
    await signInPage(res);
  }
});

app.post("/", async (req, res) => {
  if (req.session.steamId) {
    let form = formidable({ multiples: true });
    let user = await getSteamUser(req.session.steamId);

    form.parse(req, async (err, fields, files) => {
      let { image } = files;
      if (image.type !== "image/png") {
        await mainPage(req, res, 406, { error: "File not a png" });
        return;
      }

      let filePath = image.path;
      im.identify(filePath, async (err, features) => {
        if (err) {
          console.error(err);
          return;
        }
        if (features.format !== "PNG") {
          await mainPage(req, res, 406, { error: "File not a png" });
          return;
        }

        if (features.width !== 512 || features.height !== 600) {
          await mainPage(req, res, 406, {
            error: "File must be 512x600 pixels",
          });
          return;
        }

        let name = nanoid() + ".png";
        let newPath = path.join(IMG_DIR, name);
        let ddsPath = newPath.replace(/\.png$/, ".dds");
        let jsonPath = newPath.replace(/\.png$/, ".json");

        await fs.rename(filePath, newPath);

        im.convert([newPath, ddsPath], async (err) => {
          if (err) {
            await mainPage(req, res, 406, { error: err });
            return;
          }
          jsonfile.writeFileSync(jsonPath, {
            steamId: req.session.steamId,
            personaname: user.personaname,
            profileurl: user.profileurl,
          });
          await mainPage(req, res, 200, { message: "Upload successful" });
          return;
        });
      });
    });
  } else {
    await signInPage(res);
  }
});

app.get("/img/:id", async (req, res) => {
  let { id } = req.params;
  console.log(path.join(__dirname, IMG_DIR, id));
  res.sendFile(path.join(__dirname, IMG_DIR, id));
});

app.get("/template.png", async (req, res) => {
  res.sendFile(path.join(__dirname, "template.png"));
});

app.get("/auth", async (req, res) => {
  let steamId = await steam.verify(req.url);
  if (steamId) {
    req.session.steamId = steamId;
    res.redirect(302, "/");
  } else {
    res.status(403).send("Failed to sign in with Steam");
  }
});

app.get("/logout", async (req, res) => {
  req.session.destroy();
  res.redirect(302, "/");
});

app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

app.listen(process.env.PORT || 3000, () => console.log("server started..."));
