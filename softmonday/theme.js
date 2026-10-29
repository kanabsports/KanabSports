/* Soft Monday presets, matched to its lib/theme.ts. Separate from Kanab Sports preferences. */
(function () {
  'use strict';
  const themes = {
    sage: {name:'Sage',paper:'#f7f8f3',surface:'#ffffff',primary:'#405e4b',soft:'#e7eddf',accent:'#f5e4d6',ink:'#2c3d33'},
    canyon: {name:'Canyon',paper:'#faf4ef',surface:'#fffdfb',primary:'#92482f',soft:'#eed6c7',accent:'#f0ddb0',ink:'#493027'},
    coastal: {name:'Coastal',paper:'#f0fbf9',surface:'#ffffff',primary:'#087f83',soft:'#bcebe4',accent:'#f3d6a2',ink:'#163e40'},
    alpine: {name:'Alpine',paper:'#f0f2f3',surface:'#ffffff',primary:'#203f38',soft:'#ced8d9',accent:'#b8c8bc',ink:'#23332f'},
    lavender: {name:'Lavender',paper:'#f7f3f9',surface:'#ffffff',primary:'#72518b',soft:'#e9dff0',accent:'#f3dedf',ink:'#44324f'},
    desert: {name:'Desert',paper:'#f8f5ec',surface:'#fffef9',primary:'#72612e',soft:'#ebe5c9',accent:'#e9cebb',ink:'#423c2c'}
  };
  const key = 'soft-monday-pitch-theme-v1';
  function apply(id, persist) {
    if (!Object.prototype.hasOwnProperty.call(themes, id)) id = 'sage';
    const theme = themes[id];
    document.documentElement.dataset.theme = id;
    Object.entries(theme).forEach(([name,value]) => { if (name !== 'name') document.documentElement.style.setProperty('--'+name,value); });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme.paper;
    let saved = true;
    if (persist) { try { localStorage.setItem(key,id); } catch (_) { saved = false; } }
    return {id,name:theme.name,saved};
  }
  let initial = 'sage';
  try { initial = localStorage.getItem(key) || initial; } catch (_) {}
  apply(initial,false);
  try { document.documentElement.dataset.betaOnly = localStorage.getItem('soft-monday-pitch-beta-only-v1') === 'false' ? 'false' : 'true'; } catch (_) {}
  window.softMondayTheme = {apply,themes,key};
})();
