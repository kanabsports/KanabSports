from PIL import Image, ImageDraw, ImageFont
import os, subprocess, shutil

W,H=720,1280
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP='/tmp/ks-family-walkthrough'
os.makedirs(TMP,exist_ok=True)
BG='#f4f5f6'; INK='#111318'; RED='#e32636'; MUTED='#6d737c'; WHITE='#ffffff'; BLACK='#0b0c0f'; GREEN='#278558'

def font_path(bold=False):
    names=[
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    ]
    return next(p for p in names if os.path.exists(p))
def F(size,bold=False): return ImageFont.truetype(font_path(bold),size)
def rounded(d,xy,r,fill,outline=None,width=1): d.rounded_rectangle(xy,r,fill=fill,outline=outline,width=width)
def txt(d,xy,s,size,fill=INK,bold=False,anchor=None,align='left'): d.text(xy,s,font=F(size,bold),fill=fill,anchor=anchor,align=align)
def wrap(d,s,x,y,maxw,size,fill=INK,bold=False,spacing=6):
    words=s.split(); lines=[]; cur=''; font=F(size,bold)
    for w in words:
        test=(cur+' '+w).strip()
        if d.textbbox((0,0),test,font=font)[2] <= maxw: cur=test
        else:
            if cur: lines.append(cur)
            cur=w
    if cur: lines.append(cur)
    d.multiline_text((x,y),'\n'.join(lines),font=font,fill=fill,spacing=spacing)
    return y+len(lines)*(size+spacing)
def logo(d,y=32):
    txt(d,(50,y),'KANAB',34,WHITE,True); txt(d,(178,y),'SPORTS',34,RED,True)
    txt(d,(50,y+39),'powered by',14,'#aeb1b8'); txt(d,(138,y+36),'p e p',19,'#ff665c',True)
def phone_base(d,top=265,bottom=1125):
    x1,x2=60,660; rounded(d,(x1,top,x2,bottom),36,BLACK); rounded(d,(x1+10,top+10,x2-10,bottom-10),27,WHITE); rounded(d,(280,top+18,440,top+44),13,BLACK); return x1+24,top+62,x2-24,bottom-24
def app_header(d,x1,y1,x2,title='My Family'):
    rounded(d,(x1,y1,x2,y1+98),16,BLACK); txt(d,(x1+20,y1+20),'KANAB SPORTS',21,WHITE,True); txt(d,(x1+20,y1+53),'powered by p e p',12,'#b9bdc3'); txt(d,(x2-20,y1+45),title,14,WHITE,True,anchor='rm')
def bottom_nav(d,x1,y,x2,active='Home'):
    names=['Home','Schedule','Updates','Teams']; w=(x2-x1)/4; rounded(d,(x1,y,x2,y+64),14,'#111318')
    for i,n in enumerate(names):
        cx=x1+w*(i+.5); txt(d,(cx,y+23),n,12,WHITE if n==active else '#9da0a7',True,anchor='mm')
        if n==active: d.ellipse((cx-3,y+44,cx+3,y+50),fill=RED)
def scene(title,sub,step=None):
    im=Image.new('RGB',(W,H),BLACK); d=ImageDraw.Draw(im); logo(d)
    if step: txt(d,(670,48),step,14,'#aeb1b8',True,anchor='ra')
    font=F(44,True)
    if d.textbbox((0,0),title,font=font)[2] <= 620:
        txt(d,(50,112),title,44,WHITE,True); suby=168
    else: suby=wrap(d,title,50,108,620,42,WHITE,True,3)+6
    wrap(d,sub,50,suby,620,22,'#c9cdd3',False,6); return im,d

slides=[]

im,d=scene('My Family in about a minute','Schedules, coach updates, and every kid’s teams in one place.')
rounded(d,(50,300,670,870),28,'#15171b',outline='#30343b',width=2)
txt(d,(360,410),'ONE FAMILY.',58,WHITE,True,anchor='mm'); txt(d,(360,485),'ONE SCHEDULE.',58,RED,True,anchor='mm')
for i,label in enumerate(['School + rec/travel','Every kid together','Coach updates','Free for parents']):
    y=590+i*62; d.ellipse((110,y+7,124,y+21),fill=RED); txt(d,(145,y+2),label,23,WHITE,True)
rounded(d,(120,960,600,1030),18,RED); txt(d,(360,995),'Parents use My Family free',22,WHITE,True,anchor='mm')
slides.append(im)

im,d=scene('1. Open My Family','Go to kanabsports.com/family. Parents use it free.','1 of 4')
x1,y1,x2,y2=phone_base(d); app_header(d,x1,y1,x2,'My Family')
txt(d,(x1+18,y1+128),'FREE PARENT PORTAL',12,RED,True); txt(d,(x1+18,y1+157),'Your sports, simplified.',30,INK,True)
wrap(d,'School, rec, and travel teams — one family, one schedule.',x1+18,y1+205,500,16,MUTED)
rounded(d,(x1+18,y1+290,x2-18,y1+372),15,'#f7f9ff',outline='#dbe4fb'); txt(d,(x1+36,y1+310),'Already set up My Family?',17,INK,True); txt(d,(x1+36,y1+340),'Sign in with email + 6-digit PIN.',14,MUTED)
rounded(d,(x1+18,y1+405,x2-18,y1+470),13,RED); txt(d,((x1+x2)/2,y1+438),'ENTER TEAM CODES',17,WHITE,True,anchor='mm'); bottom_nav(d,x1,y2-78,x2,'Home')
slides.append(im)

im,d=scene('2. Connect the teams you use','Enter the team code from your coach. School, rec/travel, or both.','2 of 4')
x1,y1,x2,y2=phone_base(d); app_header(d,x1,y1,x2,'Connect'); txt(d,(x1+18,y1+125),'Connect your sports.',28,INK,True)
for label,val,yy in [('School code · optional','KANAB-HS',167),('Rec / travel team code · optional','KS-R4D8Q2',279),('Kid’s name or label · optional','Avery',391)]:
    txt(d,(x1+18,y1+yy),label,13,MUTED,True); rounded(d,(x1+18,y1+yy+25,x2-18,y1+yy+83),10,'#fafbfc',outline='#b9bec6'); txt(d,(x1+35,y1+yy+42),val,18,INK,True if val!='Avery' else False)
rounded(d,(x1+18,y1+505,x2-18,y1+570),13,RED); txt(d,((x1+x2)/2,y1+538),'SAVE CONNECTIONS',17,WHITE,True,anchor='mm')
rounded(d,(x1+18,y1+600,x2-18,y1+684),13,'#e9f7ef'); txt(d,(x1+35,y1+620),'LEGAL NAME NOT REQUIRED',15,GREEN,True); txt(d,(x1+35,y1+650),'Nickname, initials, or Kid 1 works too.',13,MUTED)
bottom_nav(d,x1,y2-78,x2,'Teams'); slides.append(im)

im,d=scene('3. See everyone together','Games and practices roll into one family schedule — and Pep flags overlaps.','3 of 4')
x1,y1,x2,y2=phone_base(d); app_header(d,x1,y1,x2,'Schedule')
for i,name in enumerate(['All My Kids','Avery','Jordan','Sam']):
    x=x1+18+i*126; rounded(d,(x,y1+118,x+112,y1+156),19,BLACK if i==0 else WHITE,outline='#dfe2e6'); txt(d,(x+56,y1+137),name,11,WHITE if i==0 else INK,True,anchor='mm')
rows=[('OCT','8','Soccer · Beaver','5:00 PM · Game','Avery'),('OCT','10','Football · Practice','5:30 PM · North field','Jordan'),('OCT','10','Volleyball · Enterprise','5:30 PM · Game','Sam'),('OCT','12','Soccer · Practice','4:00 PM · South field','Avery')]
base=y1+190
for i,r in enumerate(rows):
    yy=base+i*122; d.line((x1+18,yy+110,x2-18,yy+110),fill='#eceef1',width=1); rounded(d,(x1+18,yy,x1+82,yy+72),10,'#f0f2f4'); txt(d,(x1+50,yy+19),r[0],11,MUTED,True,anchor='mm'); txt(d,(x1+50,yy+48),r[1],23,INK,True,anchor='mm'); txt(d,(x1+102,yy+7),r[2],16,INK,True); txt(d,(x1+102,yy+35),r[3],14,MUTED); txt(d,(x1+102,yy+62),r[4],12,RED,True)
    if i in (1,2): txt(d,(x1+102,yy+87),'SCHEDULE CONFLICT',12,'#9b6500',True)
bottom_nav(d,x1,y2-78,x2,'Schedule'); slides.append(im)

im,d=scene('4. Coach messages stay with the team','No hunting through group texts. App notifications work even if you never use SMS.','4 of 4')
x1,y1,x2,y2=phone_base(d); app_header(d,x1,y1,x2,'Updates'); txt(d,(x1+18,y1+122),'What changed?',28,INK,True)
rounded(d,(x1+18,y1+180,x2-18,y1+352),14,'#fff8f5',outline='#ffd4d8'); txt(d,(x1+35,y1+201),'COACH UPDATE · SOCCER',12,RED,True); txt(d,(x1+35,y1+232),'Practice update',19,INK,True); wrap(d,'Practice moved to 5:00 PM. Please bring water.',x1+35,y1+268,485,17,INK); txt(d,(x1+35,y1+326),'Coach Morgan Lee · just now',12,MUTED)
rounded(d,(85,905,635,1015),20,'#f7f7f8',outline='#d7d9dc'); d.ellipse((108,934,154,980),fill=RED); txt(d,(131,957),'KS',13,WHITE,True,anchor='mm'); txt(d,(172,928),'Kanab Sports · Coach Update',16,INK,True); wrap(d,'A new coach message or important team update is ready.',172,957,420,14,MUTED,False,4)
txt(d,(360,1062),'SMS is optional and separate.',16,'#c9cdd3',True,anchor='mm'); bottom_nav(d,x1,y2-78,x2,'Updates'); slides.append(im)

im,d=scene('Save it once. Bring it to any device.','Create a free parent account, choose a 6-digit PIN, and your family setup comes with you.')
x1,y1,x2,y2=phone_base(d); app_header(d,x1,y1,x2,'Account'); txt(d,(x1+18,y1+125),'Save My Family',28,INK,True)
for label,val,yy in [('EMAIL','parent@example.com',174),('YOUR 6-DIGIT PIN','••••••',292)]:
    txt(d,(x1+18,y1+yy),label,12,MUTED,True); rounded(d,(x1+18,y1+yy+24,x2-18,y1+yy+84),10,'#fafbfc',outline='#b9bec6'); txt(d,(x1+34,y1+yy+43),val,17 if 'example' in val else 22,INK,True if '•' in val else False)
rounded(d,(x1+18,y1+420,x2-18,y1+486),13,RED); txt(d,((x1+x2)/2,y1+453),'SAVE PIN & SIGN IN',17,WHITE,True,anchor='mm')
rounded(d,(x1+18,y1+525,x2-18,y1+635),13,'#e9f7ef'); txt(d,(x1+36,y1+546),'FREE PARENT ACCOUNT',16,GREEN,True); wrap(d,'Your saved kids and teams can load on a new device after sign-in.',x1+36,y1+579,480,14,MUTED)
bottom_nav(d,x1,y2-78,x2,'Home'); slides.append(im)

im,d=scene('Put Kanab Sports on your Home Screen','iPhone / iPad — Safari')
rounded(d,(55,270,665,1045),28,WHITE); txt(d,(95,315),'iPhone',34,INK,True)
for i,s in enumerate(['Open My Family in Safari','Tap Share  ↑','Tap Add to Home Screen','Choose Open as Web App','Open the new icon','Tap Turn On Notifications']):
    y=390+i*92; d.ellipse((92,y,142,y+50),fill=RED); txt(d,(117,y+25),str(i+1),18,WHITE,True,anchor='mm'); wrap(d,s,166,y+8,430,20,INK,True,4)
rounded(d,(95,950,625,1010),14,'#f7f9ff',outline='#dbe4fb'); txt(d,(360,980),'Coach updates can now appear like app notifications.',15,'#2e5eb5',True,anchor='mm'); slides.append(im)

im,d=scene('Android / Google Chrome','Install it, then turn on notifications.')
rounded(d,(55,250,665,945),28,WHITE); txt(d,(95,295),'Android',34,INK,True)
for i,s in enumerate(['Open My Family in Chrome','Tap the ⋮ menu','Tap Add to Home Screen or Install app','Open the Kanab Sports icon','Tap Turn On Notifications']):
    y=370+i*100; d.ellipse((92,y,142,y+50),fill=RED); txt(d,(117,y+25),str(i+1),18,WHITE,True,anchor='mm'); wrap(d,s,166,y+7,430,20,INK,True,4)
rounded(d,(55,995,665,1175),22,'#15171b',outline='#30343b'); txt(d,(360,1040),'YOUR FAMILY. YOUR TEAMS.',27,WHITE,True,anchor='mm'); txt(d,(360,1085),'ONE PLACE.',34,RED,True,anchor='mm'); txt(d,(360,1135),'Kanab Sports · powered by p e p',15,'#c9cdd3',True,anchor='mm'); slides.append(im)

for i,im in enumerate(slides,1): im.save(f'{TMP}/{i:02d}.png')
slides[0].save(os.path.join(ROOT,'assets','my-family-walkthrough-poster.jpg'),quality=90)

durs=[5,8,10,11,10,8,7,7]; concat=os.path.join(TMP,'concat.txt')
open(concat,'w').close()
for n,dur in enumerate(durs,1):
    i=f'{n:02d}'; frames=dur*24; outfade=max(0,dur-.25); seg=f'{TMP}/seg{i}.mp4'
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-loop','1','-i',f'{TMP}/{i}.png','-vf',f"zoompan=z='min(zoom+0.00010,1.025)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=720x1280:fps=24,fade=t=in:st=0:d=0.25,fade=t=out:st={outfade}:d=0.25,format=yuv420p",'-t',str(dur),'-an','-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p',seg],check=True)
    with open(concat,'a') as h: h.write(f"file '{seg}'\n")
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',concat,'-c','copy','-movflags','+faststart',os.path.join(ROOT,'assets','my-family-walkthrough.mp4')],check=True)
print('Built assets/my-family-walkthrough.mp4')
