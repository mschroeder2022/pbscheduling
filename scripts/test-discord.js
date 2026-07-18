// Isolated Discord check: log in, resolve Hive/pb-scheduler, post a test message.
const { startBot, sendNotification } = require('../src/discord/bot');

(async () => {
  try {
    const { channel, client } = await startBot();
    console.log(`Connected as ${client.user.tag}, target channel #${channel.name} in "${channel.guild.name}".`);
    const ok = await sendNotification('🧪 pb-scheduler connectivity test — if you can see this, notifications work. (`/upcoming` and `/ping` are now available.)');
    console.log(ok ? 'Test message sent.' : 'Test message FAILED to send.');
    await new Promise(r => setTimeout(r, 1500));
    await client.destroy();
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error('Discord test failed:', err.message || err);
    if (err.code) console.error('code:', err.code);
    process.exit(2);
  }
})();
