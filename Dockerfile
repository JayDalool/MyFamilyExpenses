# Node bundles its own ICU time zone data. 22.23.4+ carries tzdata 2026e, which
# has Manitoba on permanent UTC-05 from 2026-11-01; older images put Winnipeg at
# UTC-06 and shift dashboard/report dates by a day from 00:00 to 00:59.
FROM node:22.23.5-bookworm-slim

# Fail the build if this Node still has the old Manitoba rule.
RUN node -e 'const o = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Winnipeg", timeZoneName: "longOffset" }).formatToParts(new Date("2027-01-15T12:00:00Z")).find((p) => p.type === "timeZoneName").value; if (o !== "GMT-05:00") { console.error("Node tz " + process.versions.tz + " puts America/Winnipeg at " + o + "; need tzdata 2026e or newer"); process.exit(1); }'

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

RUN npx prisma generate
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
