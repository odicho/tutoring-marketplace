import { githubAuth } from '@repo/auth';
import { generateState } from 'arctic';
import { cookies } from 'next/headers';

export const GET = async () => {
	const state = generateState();

	const authorizationURL = await githubAuth.createAuthorizationURL(state, {
		scopes: ['user:email'],
	});

	// store state
	cookies().set('github_oauth_state', state, {
		path: '/',
		secure: process.env.NODE_ENV === 'production',
		httpOnly: true,
		maxAge: 60 * 60,
		sameSite: 'lax',
	});

	return new Response(null, {
		status: 302,
		headers: {
			Location: authorizationURL.toString(),
		},
	});
};
