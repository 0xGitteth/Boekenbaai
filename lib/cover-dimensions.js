'use strict';
// A valid magic signature is not proof of a book cover. Read the intrinsic
// dimensions of the supported formats without allocating a decoded bitmap.
// The limits reject tracking pixels, blank placeholders and image bombs.
// Full visual edition verification is a separate check.
const {crc32,inflateSync}=require('node:zlib');
const MAX_PNG_SCAN_BYTES=32*1024*1024;
function validPngScan(data,width,height,depth,channels,interlace){
  if(!width||!height||width>MAX_SIDE||height>MAX_SIDE||width*height>MAX_PIXELS)return false;
  const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
  const rows=[];let expected=0;
  for(const [x,y,dx,dy] of passes){
    const w=Math.ceil(Math.max(0,width-x)/dx),h=Math.ceil(Math.max(0,height-y)/dy);
    if(!w||!h)continue;
    const stride=1+Math.ceil(w*depth*channels/8);
    expected+=stride*h;rows.push([stride,h]);
  }
  if(!expected||expected>MAX_PNG_SCAN_BYTES)return false;
  const scan=inflateSync(Buffer.concat(data),{maxOutputLength:expected});
  if(scan.length!==expected)return false;
  let offset=0;
  for(const [stride,h] of rows)for(let y=0;y<h;y++,offset+=stride)if(scan[offset]>4)return false;
  return true;
}
const MIN_WIDTH=60,MIN_HEIGHT=80,MAX_PIXELS=25000000,MAX_SIDE=12000;
function dimensions(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<16)return null;
  try{
    if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
      if(buffer.length<45||buffer.readUInt32BE(8)!==13||buffer.toString('ascii',12,16)!=='IHDR')return null;
      const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20);
      const depth=buffer[24],color=buffer[25],interlace=buffer[28];
      const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      const channels={0:1,2:3,3:1,4:2,6:4}[color];
      if(!depths[color]?.includes(depth)||buffer[26]!==0||buffer[27]!==0||interlace>1)return null;
      let pos=8,endedData=false,palette=false,end=false;
      const data=[];
      while(pos+12<=buffer.length){
        const size=buffer.readUInt32BE(pos),type=buffer.toString('ascii',pos+4,pos+8);
        if(size>buffer.length-pos-12)return null;
        const chunkEnd=pos+8+size;
        if(crc32(buffer.subarray(pos+4,chunkEnd))!==buffer.readUInt32BE(chunkEnd))return null;
        if(type==='IHDR'&&pos!==8)return null;
        if(type==='PLTE'){
          if(palette||data.length||!size||size%3||size>768||color===0||color===4||
            (color===3&&size/3>2**depth))return null;
          palette=true;
        }
        if(type==='IDAT'){
          if(endedData||(color===3&&!palette))return null;
          data.push(buffer.subarray(pos+8,chunkEnd));
        }else if(data.length)endedData=true;
        if(type==='IEND'){end=size===0&&pos+12===buffer.length;break;}
        pos+=size+12;
      }
      return data.length&&end&&validPngScan(data,width,height,depth,channels,interlace)?{width,height,format:'png'}:null;
    }
    const gif=buffer.toString('ascii',0,6);
    if(gif==='GIF87a'||gif==='GIF89a'){
      if(buffer[buffer.length-1]!==0x3b)return null;
      const width=buffer.readUInt16LE(6),height=buffer.readUInt16LE(8);
      let pos=13,frames=0,usableFrame=false;
      if(buffer[10]&0x80)pos+=3*(2**((buffer[10]&7)+1));
      function subblocks(){
        while(pos<buffer.length){const size=buffer[pos++];if(size===0)return true;pos+=size;if(pos>buffer.length)return false;}
        return false;
      }
      while(pos<buffer.length){
        const marker=buffer[pos++];
        if(marker===0x3b)return frames&&usableFrame&&pos===buffer.length?{width,height,format:'gif'}:null;
        if(marker===0x21){pos++;if(!subblocks())return null;continue;}
        if(marker!==0x2c||pos+9>buffer.length)return null;
        const x=buffer.readUInt16LE(pos),y=buffer.readUInt16LE(pos+2);
        const w=buffer.readUInt16LE(pos+4),h=buffer.readUInt16LE(pos+6),flags=buffer[pos+8];
        if(!w||!h||x+w>width||y+h>height)return null;
        if(w>=MIN_WIDTH&&h>=MIN_HEIGHT)usableFrame=true;
        if(!(flags&0x80)&&!(buffer[10]&0x80))return null;
        pos+=9;
        if(flags&0x80)pos+=3*(2**((flags&7)+1));
        if(pos>=buffer.length||buffer[pos]<2||buffer[pos]>8)return null;
        pos++;
        if(pos>=buffer.length||buffer[pos]===0||!subblocks())return null;
        frames++;
      }
      return null;
    }
    if(buffer[0]===0xff&&buffer[1]===0xd8){
      if(buffer[buffer.length-2]!==0xff||buffer[buffer.length-1]!==0xd9)return null;
      let pos=2,found=null;
      while(pos<buffer.length-1){
        if(buffer[pos++]!==0xff)return null;
        while(buffer[pos]===0xff)pos++;
        const marker=buffer[pos++];
        if(marker===0xda){ // Start of compressed image scan.
          if(!found||pos+2>buffer.length)return null;
          const length=buffer.readUInt16BE(pos),components=buffer[pos+2];
          if(!components||components>4||length!==6+2*components||pos+length>=buffer.length-2)return null;
          return found;
        }
        if(marker===0xd9)return null;
        if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
        if(pos+2>buffer.length)return null;
        const length=buffer.readUInt16BE(pos);
        if(length<2||pos+length>buffer.length)return null;
        if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
          const components=buffer[pos+7];
          if(length<11||!components||components>4||length!==8+3*components)return null;
          found={height:buffer.readUInt16BE(pos+3),width:buffer.readUInt16BE(pos+5),format:'jpg'};
        }
        pos+=length;
      }
      return null;
    }
    if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP'){
      if(buffer.readUInt32LE(4)+8!==buffer.length)return null;
      let pos=12,canvas=null,image=null;
      while(pos+8<=buffer.length){
        const type=buffer.toString('ascii',pos,pos+4),length=buffer.readUInt32LE(pos+4),data=pos+8;
        if(length>buffer.length-data)return null;
        if(type==='VP8X'&&length===10)canvas={width:1+buffer.readUIntLE(data+4,3),height:1+buffer.readUIntLE(data+7,3),format:'webp'};
        if(type==='VP8 '&&length>10&&!(buffer[data]&1)&&buffer.subarray(data+3,data+6).equals(Buffer.from([0x9d,1,0x2a])))
          image={width:buffer.readUInt16LE(data+6)&0x3fff,height:buffer.readUInt16LE(data+8)&0x3fff,format:'webp'};
        if(type==='VP8L'&&length>5&&buffer[data]===0x2f&&!(buffer[data+4]&0xe0)){
          const bits=buffer.readUInt32LE(data+1);
          image={width:1+(bits&0x3fff),height:1+((bits>>>14)&0x3fff),format:'webp'};
        }
        // Animated WebP has no ordinary top-level still frame. Do not
        // accept an unverified animation as a static cover.
        pos=data+length+(length&1);
      }
      if(pos!==buffer.length||!image)return null;
      if(canvas&&(canvas.width!==image.width||canvas.height!==image.height))return null;
      return image;
    }
  }catch{return null;}
  return null;
}
function usableDimensions(buffer){
  const image=dimensions(buffer);
  if(!image||image.width<MIN_WIDTH||image.height<MIN_HEIGHT
    ||image.width>MAX_SIDE||image.height>MAX_SIDE||image.width*image.height>MAX_PIXELS)return null;
  return image;
}
module.exports={dimensions,usableDimensions,MIN_WIDTH,MIN_HEIGHT};
