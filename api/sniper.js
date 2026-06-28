import fetch from 'node-fetch';

export default async function handler(req, res) {
    // Only allow POST requests from your executor
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { username, placeId } = req.body;
    const cookie = process.env.ROBLOX_COOKIE;

    // Validate parameters and ensure the environmental cookie exists
    if (!username || !placeId) {
        return res.status(400).json({ error: 'Missing parameters (username or placeId)' });
    }
    if (!cookie) {
        return res.status(500).json({ error: 'Backend Configuration Error: ROBLOX_COOKIE variable is missing on Vercel.' });
    }

    try {
        // 1. Resolve Target Username to UserId
        const userRes = await fetch("https://users.roblox.com/v1/users/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keyword: username, limit: 10 })
        });
        const userData = await userRes.json();
        
        if (!userData.data || userData.data.length === 0) {
            return res.status(404).json({ success: false, message: 'Target user not found.' });
        }
        const userId = userData.data[0].id;

        // 2. Fetch the target avatar thumbnail headshot string
        const thumbRes = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&format=Png&size=150x150&isCircular=false`);
        const thumbData = await thumbRes.json();
        
        if (!thumbData.data || thumbData.data.length === 0) {
            return res.status(404).json({ success: false, message: 'Target thumbnail could not be retrieved.' });
        }
        const targetThumbUrl = thumbData.data[0].imageUrl;

        // 3. Scan Public Server Instances using the authentication cookie
        let cursor = null;
        let foundServerId = null;

        while (true) {
            let url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100`;
            if (cursor) url += `&cursor=${cursor}`;

            const serverRes = await fetch(url, {
                headers: {
                    'Cookie': `.ROBLOSECURITY=${cookie}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                }
            });

            const serverData = await serverRes.json();
            if (!serverData.data || serverData.data.length === 0) break;

            // Deep match raw tokens against your authenticated session
            for (const server of serverData.data) {
                if (server.playerTokens && server.playerTokens.length > 0) {
                    
                    const batchRes = await fetch("https://thumbnails.roblox.com/v1/batch", {
                        method: "POST",
                        headers: { 
                            "Content-Type": "application/json",
                            "Cookie": `.ROBLOSECURITY=${cookie}`
                        },
                        body: JSON.stringify(server.playerTokens.map(token => ({
                            token: token,
                            type: "AvatarHeadShot",
                            size: "150x150",
                            format: "png",
                            isCircular: false
                        })))
                    });
                    
                    const batchData = await batchRes.json();
                    
                    if (batchData.data) {
                        for (const playerThumb of batchData.data) {
                            if (playerThumb.imageUrl && playerThumb.imageUrl === targetThumbUrl) {
                                foundServerId = server.id;
                                break;
                            }
                        }
                    }
                }
                if (foundServerId) break;
            }

            if (foundServerId || !serverData.nextPageCursor) break;
            cursor = serverData.nextPageCursor;
        }

        // Return results back to the mobile game executor
        if (foundServerId) {
            return res.status(200).json({ success: true, serverId: foundServerId });
        } else {
            return res.status(200).json({ success: false, message: "Target not found in any active public shards." });
        }

    } catch (err) {
        return res.status(500).json({ error: "Internal Server Error: " + err.message });
    }
}
