'use strict';
// A valid magic signature is not proof of a book cover. Read the intrinsic
// dimensions of the supported formats without allocating a decoded bitmap.
// The limits reject tracking pixels, blank placeholders and image bombs.
// Full image decoding/visual edition verification is a separate check.
const MIN_WIDTH=60,MIN_HEIGHT=80,MAX_PIXELS=25000000,MAX_SIDE=12000;
function dimensions(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<16)return null;
  try{
    if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
      if(buffer.length<45||buffer.readUInt32BE(8)!==13||buffer.toString('ascii',12,16)!=='IHDR')return null;
      let pos=8,hasData=false,end=false;
      while(pos+12<=buffer.length){
        const size=buffer.readUInt32BE(pos),type=buffer.toString('ascii',pos+4,pos+8);
        if(size>buffer.length-pos-12)return null;
        if(type==='IDAT'&&size>0)hasData=true;
        if(type==='IEND'){end=size===0&&pos+12===buffer.length;break;}
        pos+=size+12;
      }
      return hasData&&end?{width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20),format:'png'}:null;
    }
    const gif=buffer.toString('ascii',0,6);
    if(gif==='GIF87a'||gif==='GIF89a'){
      if(buffer[buffer.length-1]!==0x3b)return null;
      const width=buffer.readUInt16LE(6),height=buffer.readUInt16LE(8);
      let pos=13,frames=0;
      if(buffer[10]&0x80)pos+=3*(2**((buffer[10]&7)+1));
      function subblocks(){
        while(pos<buffer.length){const size=buffer[pos++];if(size===0)return true;pos+=size;if(pos>buffer.length)return false;}
        return false;
      }
      while(pos<buffer.length){
        const marker=buffer[pos++];
        if(marker===0x3b)return frames&&pos===buffer.length?{width,height,format:'gif'}:null;
        if(marker===0x21){pos++;if(!subblocks())return null;continue;}
        if(marker!==0x2c||pos+9>buffer.length)return null;
        const x=buffer.readUInt16LE(pos),y=buffer.readUInt16LE(pos+2);
        const w=buffer.readUInt16LE(pos+4),h=buffer.readUInt16LE(pos+6),flags=buffer[pos+8];
        if(!w||!h||x+w>width||y+h>height)return null;
        pos+=9;
        if(flags&0x80)pos+=3*(2**((flags&7)+1));
        if(pos>=buffer.length||buffer[pos]<2||buffer[pos]>8)return null;
        pos++;
        if(!subblocks())return null;
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
        if(marker===0xda)return found; // Start of compressed image scan.
        if(marker===0xd9)return null;
        if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
        if(pos+2>buffer.length)return null;
        const length=buffer.readUInt16BE(pos);
        if(length<2||pos+length>buffer.length)return null;
        if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
          if(length<8)return null;
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
        if(type==='VP8 '&&length>=10&&buffer.subarray(data+3,data+6).equals(Buffer.from([0x9d,1,0x2a])))
          image={width:buffer.readUInt16LE(data+6)&0x3fff,height:buffer.readUInt16LE(data+8)&0x3fff,format:'webp'};
        if(type==='VP8L'&&length>=5&&buffer[data]===0x2f){
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
