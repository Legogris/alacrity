module Alacrity.EmitJS where

import qualified Data.Map.Strict as M
import Data.List (intersperse)
import Data.Text.Prettyprint.Doc

import Alacrity.AST
import Alacrity.EmitSol (solMsg_evt, solMsg_fun, solType)

{- Compilation to Javascript

   I'm imagining the type of the JS export is:

   Network -> Participant -> NetworkArgs x Args x (Result -> A) -> A or doesn't

   We have some standard way of interacting with the network (so we
   don't depend in the compiler on whether we're using rinkydink or
   whatever or what the name is.) Then, you can look up the code for
   one of the participants (by name). Then you provide extra arguments
   for the network (such as the contract / game id) and the
   participant's initial knowledge, then a continuation for what to do
   with the result.
  -}

jsString :: String -> Doc a
jsString s = dquotes $ pretty s

jsVar :: BLVar -> Doc a
jsVar (n, _, _) = pretty $ "v" ++ show n

jsVarType :: BLVar -> Doc a
jsVarType (_, _, bt) = jsString $ solType bt

jsCon :: Constant -> Doc a
jsCon (Con_I i) = pretty i
jsCon (Con_B True) = pretty "true"
jsCon (Con_B False) = pretty "false"
jsCon (Con_BS s) = jsString $ show s

jsArg :: BLArg -> Doc a
jsArg (BL_Var v) = jsVar v
jsArg (BL_Con c) = jsCon c

jsPartVar :: Participant -> Doc a
jsPartVar p = pretty $ "p" ++ p

jsVarDecl :: BLVar -> Doc a
jsVarDecl bv = pretty "var" <+> jsVar bv

jsBraces :: Doc a -> Doc a
jsBraces body = braces (nest 2 $ hardline <> body <> space)

jsArray :: [Doc a] -> Doc a
jsArray elems = brackets $ hcat $ intersperse (comma <> space) elems

jsApply :: String -> [Doc a] -> Doc a
jsApply f args = pretty f <> parens (hcat $ intersperse (comma <> space) args)

jsFunction :: String -> [Doc a] -> Doc a -> Doc a
jsFunction name args body =
  pretty "function" <+> jsApply name args <+> jsBraces body

jsLambda :: [Doc a] -> Doc a -> Doc a
jsLambda args body = jsApply "" args <+> pretty "=>" <+> jsBraces body

jsReturn :: Doc a -> Doc a
jsReturn a = pretty "return" <+> a <> semi

jsObject :: [(String, Doc a)] -> Doc a
jsObject kvs = jsBraces $ vsep $ (intersperse comma) $ map jsObjField kvs
  where jsObjField (k, v) = pretty (k ++ ":") <> hardline <> v

jsBinOp :: String -> Doc a -> Doc a -> Doc a
jsBinOp o l r = l <+> pretty o <+> r

jsPrimApply :: EP_Prim -> [Doc a] -> Doc a
jsPrimApply pr args =
  case pr of
    CP ADD -> binOp "+"
    CP SUB -> binOp "-"
    CP MUL -> binOp "*"
    CP DIV -> binOp "/"
    CP MOD -> binOp "%"
    CP PLT -> binOp "<"
    CP PLE -> binOp "<="
    CP PEQ -> binOp "=="
    CP PGE -> binOp ">="
    CP PGT -> binOp ">"
    CP IF_THEN_ELSE -> case args of
                      [ c, t, f ] -> c <+> pretty "?" <+> t <+> pretty ":" <+> f
                      _ -> spa_error ()
    CP INT_TO_BYTES -> jsApply "stdlib.hexOf" args
    CP DIGEST -> jsApply "stdlib.keccak256" args
    CP BYTES_EQ -> binOp "=="
    CP BYTES_LEN -> case args of
                   [ a ] -> a <> pretty ".length"
                   _ -> spa_error ()
    CP BCAT -> jsApply "stdlib.hexOf" args
    CP BCAT_LEFT -> jsApply "stdlib.bytes_left" args -- not available for now
    CP BCAT_RIGHT -> jsApply "stdlib.bytes_right" args -- now available for now
    CP DISHONEST -> case args of
                   [] -> jsCon (Con_B True)
                   _ -> spa_error ()
    RANDOM -> jsApply "stdlib.randomSalt" args
    INTERACT -> error "interact doesn't use jsPrimApply"
  where binOp op = case args of
          [ l, r ] -> jsBinOp op l r
          _ -> spa_error ()
        spa_error () = error "jsPrimApply"

jsEPExpr :: EPExpr -> Doc a
jsEPExpr (EP_Arg a) = jsArg a
jsEPExpr (EP_PrimApp pr al) = jsPrimApply pr $ map jsArg al

jsEPStmt :: EPStmt -> Doc a
jsEPStmt (EP_Assert a) = jsApply "stdlib.assert" [ jsArg a ]
jsEPStmt (EP_Send i svs msg amt) = jsApply "net.send" [ jsString (solMsg_fun i), ts, vs, jsArg amt ]
  where args = svs ++ msg
        ts = jsArray $ map jsVarType args
        vs = jsArray $ map jsVar args

jsEPTail :: EPTail -> Doc a
jsEPTail (EP_Ret al) = (jsApply "kTop" $ map jsArg al) <> semi
jsEPTail (EP_If ca tt ft) =
  pretty "if" <+> parens (jsArg ca) <> bp tt <> hardline <> pretty "else" <> bp ft
  where bp at = jsBraces $ jsEPTail at
jsEPTail (EP_Let v (EP_PrimApp INTERACT al) kt) =
  jsApply "interact" ((map jsArg al) ++ [ kp ])
  where kp = jsLambda [ jsVar v ] $ jsEPTail kt
jsEPTail (EP_Let bv ee kt) = vsep [ jsVarDecl bv <+> pretty "=" <+> jsEPExpr ee <> semi, jsEPTail kt ];
jsEPTail (EP_Do es kt) = vsep [ jsEPStmt es <> semi, jsEPTail kt ];
jsEPTail (EP_Recv i _ msg kt) = jsApply "net.recv" [ jsString (solMsg_evt i), msg_ts, kp ]
  where kp = jsLambda msg_vs (jsEPTail kt)
        msg_ts = jsArray $ map jsVarType msg
        msg_vs = map jsVar msg

jsPart :: [Participant] -> Participant -> (Participant, EProgram) -> (String, Doc a)
jsPart ps initiator (p, (EP_Prog pargs et)) = (p, partp)
  where ps_vs = map jsPartVar ps
        pargs_vs = map jsVar pargs
        ctc_v = pretty "ctc"
        part_args = if initiator == p then ps_vs
                    else ctc_v : ps_vs
        netcall = if initiator == p then "net.make" else "net.attach"
        ncargs = part_args ++ [ kp ]
        all_args = part_args ++ pargs_vs ++ [pretty "kTop"]
        first_call = jsReturn $ jsApply netcall ncargs
        partp = jsLambda all_args first_call
        kp = jsLambda [] (jsEPTail et)

emit_js :: BLProgram -> Doc a
emit_js (BL_Prog _ (C_Prog _ [])) =
  error "emit_js: Cannot create contract with no consensus"
emit_js (BL_Prog pm (C_Prog ps (C_Handler initiator _ _ _ : _))) = modp
  where modp = vsep [ pretty "import * as stdlib from './alacrity-runtime.mjs';", emptyDoc,
                      pretty "export" <+> jsFunction "initialize" [ pretty "net", pretty "interact" ] bodyp ]
        bodyp = jsReturn objp
        objp = jsObject $ map (jsPart ps initiator) $ M.toList pm
