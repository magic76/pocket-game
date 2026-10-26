// Static GitHub Pages configuration. Never commit private TURN credentials.
(function(root){
  root.POCKET_PEER_CONFIG = {host:'0.peerjs.com',port:443,path:'/',key:'peerjs',secure:true,debug:0};
  root.POCKET_ICE_SERVERS = [{urls:'stun:stun.l.google.com:19302'}];
  // Optional public/ephemeral TURN credentials: {urls,username,credential}. Avoid permanent secrets in public JS.
  root.POCKET_TURN_SERVERS = [];
  if(root.POCKET_P2P_DEFAULT===undefined) root.POCKET_P2P_DEFAULT = /\.(github\.io|workers\.dev)$/i.test(location.hostname);
})(window);
