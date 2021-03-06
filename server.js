require("dotenv").config();
let MemoryStoreFactory = require("memorystore");
let Steam = require("openid-steam");
let _nanoid = require("nanoid");
let express = require("express");
let fetch = require("node-fetch");
let formidable = require("formidable");
let fs = require("fs");
let helmet = require("helmet");
let im = require("imagemagick");
let jsonfile = require("jsonfile");
let mkdirp = require("mkdirp");
let mv = require("mv");
let path = require("path");
let pino = require("express-pino-logger");
let session = require("express-session");

let alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
let nanoid = _nanoid.customAlphabet(alphabet, 14);

let MemoryStore = MemoryStoreFactory(session);

let IMG_DIR =
  process.env.NODE_ENV === "production" ? "/var/data/images" : "./data/images";

// Ensure the img dir exists
mkdirp.sync(IMG_DIR);

let DOMAIN =
  process.env.NODE_ENV === "production"
    ? "https://custom-frames.verminti.de"
    : "http://localhost:3000";

let ban_list = [
  "76561198169033588", // iLooking123
];

let steam = new Steam(DOMAIN + "/auth");
let app = express();

app.use(helmet());
app.use(pino());
app.set("trust proxy", 1); // trust first proxy
app.use(
  session({
    secret: process.env.SECRET || "keyboard-catto",
    resave: true,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 86400000, // 24 hours
    },
    store: new MemoryStore({
      checkPeriod: 86400000, // 24 hours
    }),
  })
);

function tpl(body) {
  return `
    <!doctype>
    <html>
      <head>
        <title>Custom Frames</title>
        <link rel="preconnect" href="https://fonts.gstatic.com">
        <link href="https://fonts.googleapis.com/css2?family=IM+Fell+English&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'IM Fell English', serif;
            font-size: 1.25rem;
          }
          p {
            margin: 0.2rem 0;
          }
          a {
            color: teal;
          }
          input {
            margin-top: 1rem;
          }
          .error {
            color: darkred;
          }
          .message {
            color: seagreen;
          }
          .frames {
            display: grid;
            justify-content: center;
            gap: 1rem;
            grid-template-columns: repeat(auto-fit, 200px);
            margin-bottom: 5rem;
          }
          .frame-container {
            width: 200px;
            text-align: center;
          }
          .frame-container small {
            display: block;
            margin-bottom: .25rem;
          }
          .frame-container small pre {
            margin: 0;
            font-size: .8rem
          }
          .footer {
            position: fixed;
            bottom: 0;
            width: 100%;
            display: block;
            margin: 1rem;
            margin-bottom: .25rem;
            text-align: center;
            opacity: 0.5;
          }
          .footer:hover {
            opacity: 1;
          }
        </style>
      </head>
      <body>
        ${body}
        <small class="footer">Made by <a href="https://raindi.sh">raindish</a>. Get the <a href="https://steamcommunity.com/sharedfiles/filedetails/?id=1703217915">mod</a>!</small>
      </body>
      <script src="/script.js"></script>
    </html>
  `;
}

async function framesList({ currentSteamId, onlyOwn } = { onlyOwn: false }) {
  let frames = fs
    .readdirSync(IMG_DIR)
    .map(function (fileName) {
      return {
        name: fileName,
        time: fs.statSync(path.join(IMG_DIR, fileName)).mtime.getTime(),
      };
    })
    .sort(function (a, b) {
      return b.time - a.time;
    })
    .map(function (v) {
      return v.name;
    })
    .map((filename) => {
      if (filename.endsWith(".json")) {
        let content = jsonfile.readFileSync(path.join(IMG_DIR, filename));
        let pngUrl = filename.replace(/.json$/, ".png");
        let ddsUrl = filename.replace(/.json$/, ".dds");
        let id = filename.replace(/.json$/, "");
        return {
          id,
          steamId: content.steamId,
          personaname: content.personaname,
          profileurl: content.profileurl,
          png: pngUrl,
          dds: ddsUrl,
        };
      }
    })
    .filter(Boolean)
    .filter((frame) => {
      if (onlyOwn) {
        return frame.steamId === currentSteamId;
      }
      return true;
    });
  return `
      <div class="frames">
        ${frames
          .map(
            (frame) =>
              `<div class="frame-container">
              <img height="200" src="/img/${frame.png}"/>
              <small>Uploaded by <a href="${frame.profileurl}">${
                frame.personaname
              }</a></small>
              <button class="copy-button" data-link="/img/${
                frame.dds
              }">Copy link</button>
              ${
                currentSteamId && currentSteamId === frame.steamId
                  ? `<button class="delete-button" data-link="/img/${frame.id}">Delete</button>`
                  : ""
              }
            </div>`
          )
          .join("")}
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

async function mainPage(req, res, status, content = { onlyOwn: false }) {
  let user = await getSteamUser(req.session.steamId);
  let { error, message, onlyOwn } = content;

  let pageLink = onlyOwn
    ? `<a href="/">All Frames</a>`
    : `<a href="/my-frames">My Frames</a>`;

  res.status(status).send(
    tpl(`
      <p>Hello, <a href=${user.profileurl}>${
      user.personaname
    }</a>. ${pageLink} <a href="/logout">Log out</a></p>
      <form action="/upload" method="POST" enctype="multipart/form-data">
        <p>Frames must be png files that are 512px wide and 600px high.</p>
        <p>Download the <a href="/template.png">template</a>.</p>
        <input type="file" name="image" />
        <button type="submit">Upload</button>
        ${message ? `<p class="message">${message}</p>` : ""}
        ${error ? `<p class="error">${error}</p>` : ""}
      </form>
      ${await framesList({ currentSteamId: req.session.steamId, onlyOwn })}
      `)
  );
}

app.get("/", async (req, res) => {
  if (req.session.steamId) {
    let { message, error } = req.session;
    req.session.message = null;
    req.session.error = null;
    await mainPage(req, res, 200, { message, error });
  } else {
    await signInPage(res);
  }
});

app.get("/my-frames", async (req, res) => {
  if (req.session.steamId) {
    let { message, error } = req.session;
    req.session.message = null;
    req.session.error = null;
    await mainPage(req, res, 200, { message, error, onlyOwn: true });
  } else {
    res.redirect(307, "/");
    return;
  }
});

app.post("/upload", async (req, res) => {
  if (req.session.steamId) {
    if (ban_list.includes(req.session.steamId)) {
      res.redirect(301, "https://fuckoff.com");
      return;
    }
    let form = formidable({ multiples: true });
    let user = await getSteamUser(req.session.steamId);

    form.parse(req, async (err, fields, files) => {
      let { image } = files;

      if (!image) {
        req.session.error = "File must be a png";
        res.redirect(301, "/");
        return;
      }

      if (image.type !== "image/png") {
        req.session.error = "File must be a png";
        res.redirect(301, "/");
        return;
      }

      let filePath = image.path;
      im.identify(filePath, async (err, features) => {
        if (err) {
          console.error(err);
          req.session.error = err.toString();
          res.redirect(301, "/");
          return;
        }
        if (features.format !== "PNG") {
          req.session.error = "File must be a png";
          res.redirect(301, "/");
          return;
        }

        if (features.width !== 512 || features.height !== 600) {
          req.session.error = "File must be 512x600 pixels";
          res.redirect(301, "/");
          return;
        }

        let name = nanoid() + ".png";
        let newPath = path.join(IMG_DIR, name);
        let ddsPath = newPath.replace(/\.png$/, ".dds");
        let jsonPath = newPath.replace(/\.png$/, ".json");

        mv(filePath, newPath, async (err) => {
          if (err) {
            req.session.error = err.toString();
            res.redirect(301, "/");
            return;
          }
          im.convert([newPath, ddsPath], async (err) => {
            if (err) {
              req.session.error = err.toString();
              res.redirect(301, "/");
              return;
            }
            jsonfile.writeFileSync(jsonPath, {
              steamId: req.session.steamId,
              personaname: user.personaname,
              profileurl: user.profileurl,
            });
            req.session.message = "Upload successful";
            res.redirect(301, "/");
            return;
          });
        });
      });
    });
  } else {
    await signInPage(res);
  }
});

app.get("/img/:id", async (req, res) => {
  let { id } = req.params;
  let filepath = IMG_DIR.startsWith("/")
    ? path.join(IMG_DIR, id)
    : path.join(__dirname, IMG_DIR, id);
  res.sendFile(filepath);
});

app.delete("/img/:id", async (req, res) => {
  let { id } = req.params;
  if (!req.session.steamId) {
    res.redirect(401, "/");
    return;
  }

  let filepath = IMG_DIR.startsWith("/")
    ? path.join(IMG_DIR, id)
    : path.join(__dirname, IMG_DIR, id);

  let jsonPath = filepath + ".json";
  let pngPath = filepath + ".png";
  let ddsPath = filepath + ".dds";

  if (!fs.existsSync(jsonPath)) {
    res.redirect(404, "/");
    return;
  }

  let data = jsonfile.readFileSync(jsonPath);

  if (data.steamId !== req.session.steamId) {
    res.redirect(401, "/");
    return;
  }

  fs.unlinkSync(jsonPath);
  fs.unlinkSync(pngPath);
  fs.unlinkSync(ddsPath);

  res.status(200).send();
  return;
});

app.get("/template.png", async (req, res) => {
  res.sendFile(path.join(__dirname, "template.png"));
});

app.get("/script.js", (req, res) => {
  res.sendFile(path.join(__dirname, "script.js"));
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
