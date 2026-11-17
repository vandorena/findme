# Task: put the GeoLite2 databases into the Coolify `geo` volume

You are a browser agent working in the user's Coolify dashboard. The app "find me by ear" runs there as a Docker Compose resource with two services, `web` (Rails) and `solver`. `web` reads `/data/geo/GeoLite2-City.mmdb`, which is a named volume `geo` mounted read-only. That volume is empty, so every visitor gets "We can't place your network at all". Your job is to fill the volume, restart `web`, and confirm it worked.

## Rules
- **Never type, paste, read aloud or repeat the MaxMind account ID or license key.** The user types them into the terminal prompt themselves. If a step seems to need you to enter them, stop and hand that step to the user.
- Don't create accounts, change Coolify settings, edit environment variables, or redeploy from git. The only thing you restart is the existing resource.
- If anything is ambiguous, stop and ask the user. That includes more than one matching volume, more than one server, or an unexpected error.

## Before you start (the user does this)
The user needs a free MaxMind account (https://www.maxmind.com/en/geolite2/signup) and a license key (Account → Manage License Keys → Generate). They should have the **account ID** and **license key** ready to type. If they don't, stop and tell them.

## Steps
1. **Open the server terminal.** In Coolify, go to **Servers**, open the server this app runs on, and open its **Terminal**. If Coolify asks which server, pick the one hosting the `me` / find-me-by-ear resource, and ask the user if that's unclear.

2. **Find the volume.** Run:
   ```sh
   docker volume ls -q | grep -E '_geo$'
   ```
   You need exactly one result, usually `<resource-id>_geo`. If there are zero or several, stop and show the output to the user.

3. **Let the user enter the credentials.** Run this, then tell the user: "Please click into the terminal and type your MaxMind account ID, press Enter, then your license key, press Enter. Nothing will show as you type."
   ```sh
   read -rsp 'MaxMind account ID: ' MM_ID; echo; read -rsp 'MaxMind license key: ' MM_KEY; echo; export MM_ID MM_KEY
   ```
   Wait until the user says they've done it.

4. **Download into the volume.** This step makes the server download the two databases from MaxMind (about 70 MB). Run:
   ```sh
   VOL=$(docker volume ls -q | grep -E '_geo$')
   docker run --rm -e MM_ID -e MM_KEY -v "$VOL":/data/geo alpine sh -c '
     set -e; apk add -q curl; cd /tmp
     for db in GeoLite2-City GeoLite2-ASN; do
       curl -fsSL -u "$MM_ID:$MM_KEY" "https://download.maxmind.com/geoip/databases/$db/download?suffix=tar.gz" | tar xz
       cp ${db}_*/$db.mmdb /data/geo/
     done
     chmod 644 /data/geo/*.mmdb; ls -la /data/geo'
   unset MM_ID MM_KEY
   ```
   Success means the listing shows `GeoLite2-City.mmdb` (about 60 MB) and `GeoLite2-ASN.mmdb`.
   - A `401` from curl means the ID or key was wrong. Repeat step 3, then this step.
   - Any other error: stop and report it.

5. **Restart the app.** Go to **Projects**, open the project and the find-me-by-ear resource, and click **Restart**. Use Restart, not Redeploy. Wait until both services show as running/healthy.

6. **Check it.** On the resource's **Terminal** tab, choose the `web` container and run:
   ```sh
   bin/rails runner 'p GeoLookup.instance.available?'
   ```
   It should print `true`.

7. **Check the site.** Open the app's public URL, set the slider to 1 minute, and click start.
   - **Working:** the status line reads "listening. Your network says <some city>…". When the browser asks for the microphone, deny it; you don't need to record anything.
   - **Not working:** the old "can't place your network" error comes back. Report it.

## Report back
Tell the user:
- the volume name
- the file listing from step 4
- the result of step 6
- what the page said in step 7

Never include the credentials in the report.
