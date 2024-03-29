import { githubAuth, lucia } from '@repo/auth';
import { db } from '@repo/db';
import { oauth_account, user } from '@repo/db/schema';
import { OAuth2RequestError } from '@repo/auth/arctic';
import { createId } from '@paralleldrive/cuid2';
import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

export const GET = async (request: NextRequest) => {
	const url = new URL(request.url);
	const storedState = cookies().get('github_oauth_state')?.value;
	const state = url.searchParams.get('state');
	const code = url.searchParams.get('code');

	// validate state
	if (!storedState || !state || !code || storedState !== state) {
		return new Response(null, {
			status: 400,
		});
	}

	try {
		const tokens = await githubAuth.validateAuthorizationCode(code);

		const githubUserResponse = await fetch('https://api.github.com/user', {
			headers: {
				Authorization: `Bearer ${tokens.accessToken}`,
			},
		});
		const githubUser: GitHubUser = await githubUserResponse.json();

		const existingUserResponse = await db
			.select()
			.from(oauth_account)
			.where(
				and(
					eq(oauth_account.providerId, 'github'),
					eq(oauth_account.providerUserId, githubUser.id.toString()),
				),
			);

		const existingUser = existingUserResponse[0];

		if (existingUser) {
			const session = await lucia.createSession(existingUser.userId, {});
			const sessionCookie = lucia.createSessionCookie(session.id);

			return new Response(null, {
				status: 302,
				headers: {
					Location: '/',
					'Set-Cookie': sessionCookie.serialize(),
				},
			});
		}

		if (!githubUser.email) {
			const response = await fetch('https://api.github.com/user/emails', {
				headers: {
					Authorization: `Bearer ${tokens.accessToken}`,
				},
			});

			if (response.ok) {
				const emails: GitHubEmail[] = await response.json();
				const primaryOrFirstEmail = emails.find((e) => e.primary) ?? emails[0];
				githubUser.email = primaryOrFirstEmail?.email ?? null;
			}
		}

		const userId = createId();
		await db.transaction(async (tx) => {
			await tx.insert(user).values({
				id: userId,
				username: githubUser.login,
				email: githubUser.email,
				image: githubUser.avatar_url,
			});
			await tx
				.insert(oauth_account)
				.values({ providerId: 'github', providerUserId: githubUser.id.toString(), userId });
		});

		const session = await lucia.createSession(userId, {});
		const sessionCookie = lucia.createSessionCookie(session.id);

		return new Response(null, {
			status: 302,
			headers: {
				Location: '/',
				'Set-Cookie': sessionCookie.serialize(),
			},
		});
	} catch (e) {
		if (e instanceof OAuth2RequestError) {
			// invalid code
			return new Response(null, {
				status: 400,
			});
		}
		return new Response(null, {
			status: 500,
		});
	}
};

interface GitHubUser {
	id: number;
	login: string;
	email: string | null;
	avatar_url: string;
}

export interface GitHubEmail {
	email: string;
	primary: boolean;
	verified: boolean;
	visibility: 'public' | 'private';
}
