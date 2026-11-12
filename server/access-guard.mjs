import {BookingError} from './booking-state.mjs';
export function guardBookingAccess(portal,accessTokens){
 const original=portal.book.bind(portal);
 portal.book=async(rule,slot,options={})=>{
  let reservation=null,submitted=false;
  try{
   const result=await original(rule,slot,{...options,beforeSubmit:async candidate=>{
    try{reservation=accessTokens.reserve(rule.accessTokenId,rule,candidate);}catch(e){throw new BookingError('access_disabled','not_sent','access',e.message);}
    try{await options.beforeSubmit?.(candidate);}catch(e){accessTokens.settle(reservation,'rejected');throw e;}
    submitted=true;
   }});
   if(result.confirmed)accessTokens.settle(reservation,'confirmed');return result;
  }catch(e){if(reservation&&(!submitted||['not_sent','rejected'].includes(e.outcome)))accessTokens.settle(reservation,'rejected');throw e;}
 };
 return portal;
}
