/**
 * Welcome to Cloudflare Workers!
 *
 * This is a template for a Scheduled Worker: a Worker that can run on a
 * configurable interval:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Run `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"` to see your Worker in action
 * - Run `npm run deploy` to publish your Worker
 *
 * Bind resources to your Worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { XMLParser } from 'fast-xml-parser';

export interface VideoInfo {
	id: string;
	title: string;
	description: string;
}

function parseLatest(xml: string): VideoInfo | null {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: '@_',
	});
	// Parse entire feed
	const obj = parser.parse(xml);
	// feed.entry might be an array or a single object
	let entries = obj.feed?.entry;

	if (!entries) return null;
	if (!Array.isArray(entries)) entries = [entries];
	// Take the first (newest) entry
	const e = entries[0];

	// yt:videoId is either e["yt:videoId"] or e.videoId
	const id = e['yt:videoId'] ?? e.videoId;

	// title is e.title
	const title = typeof e.title === 'object' ? e.title['#text'] : e.title;
	// description lives under media:description or just description
	const descObj = e['media:group']['media:description'] ?? e.description;
	const description = typeof descObj === 'object' ? descObj['#text'] : descObj;

	if (!id || !title || !description) return null;
	return { id, title, description };
}

const getRssForVideo = async () => {
	const CHANNEL_ID = 'UCbRP3c757lWg9M-U7TyEkXA';

	const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

	const response = await fetch(rssUrl);
	const xml = await response.text();

	const video = parseLatest(xml);

	return video;
};

const prepareMessage = (video: VideoInfo) => {
	return `New video uploaded: **${video.title}**\n\n${video.description}`;
};

async function sendDiscordMessage(props: { message: string; env: Env }): Promise<void> {
	const { DISCORD_TOKEN, DISCORD_CHANNEL_ID } = props.env;
	const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`;

	const clean = props.message.replace(/(https?:\/\/[^\s]+)/g, (url) => `\`${url}\``);

	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bot ${DISCORD_TOKEN}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ content: clean }),
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Discord API error [${res.status}]: ${body || res.statusText}`);
	}
}

const checkCacheForVideo = async (props: { videoId: string; env: Env }) => {
	const { videoId, env } = props;

	const video = await env.KV_CHANNEL_UPLOAD_BOT.get(videoId);

	return video;
};

const saveVideoToCache = async (props: { video: VideoInfo; env: Env }) => {
	const { video, env } = props;

	await env.KV_CHANNEL_UPLOAD_BOT.put(video.id, JSON.stringify(video));
};

export default {
	async fetch(req) {
		const url = new URL(req.url);
		url.pathname = '/__scheduled';
		url.searchParams.append('cron', '* * * * *');
		return new Response(`To test the scheduled handler, ensure you have used the "--test-scheduled" then try running "curl ${url.href}".`);
	},

	// The scheduled handler is invoked at the interval set in our wrangler.jsonc's
	// [[triggers]] configuration.
	async scheduled(event, env, ctx): Promise<void> {
		const videoData = await getRssForVideo();

		if (!videoData) {
			console.error('No video data found, error fetching from rss');
			return;
		}

		const hasSent = await checkCacheForVideo({ videoId: videoData.id, env });

		if (!!hasSent) {
			console.log('Video already sent, skipping');
			return;
		}

		const message = prepareMessage(videoData);

		await sendDiscordMessage({ message, env });

		await saveVideoToCache({ video: videoData, env });

		console.log('Video sent and cached');
	},
} satisfies ExportedHandler<Env>;
