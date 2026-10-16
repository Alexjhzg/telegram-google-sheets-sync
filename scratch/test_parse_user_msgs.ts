import { parsearReporte } from "../src/utils/parser.js";

const msgs = [
  {
    remitente: "Yonlis",
    hora: "16:05",
    texto: `*Formato de reporte salida a campo*
   *1. Municipio:* caripe
   *2. Nodo:* 16044
   
*Total Verificadores en el nodo:* 02

➡️*Bloque (1) 9am: *
➡️*Bloque (2) 2pm:* 
➡️*Bloque (3) 6pm:*1`
  },
  {
    remitente: "Ruth Bronis",
    hora: "16:55",
    texto: `Formato de reporte salida a campo
   1. Municipio: PIAR
   2. Nodo: 16022
   3. Total de Verificadores en el nodo:1

➡️Bloque (1) 9am:0
➡️Bloque (2) 2pm:0
➡️Bloque (3) 6pm:0
El Verificador no va a salir a Campo hoy recibiendo Cotillón Electoral`
  },
  {
    remitente: "JesusZM_",
    hora: "17:18",
    texto: `Formato de reporte salida a campo
   *1. Municipio:* Maturin
   *2. Nodo:* 16115
   
*Total Verificadores en el nodo:* 3

➡️*Bloque (1) 9am:* 0
➡️*Bloque (2) 2pm:* 2
➡️*Bloque (3) 6pm:* 1`
  },
  {
    remitente: "R.A Ore y.",
    hora: "17:25",
    texto: `Formato de reporte y salida a campo
   1. Municipio: libertador 
   2. Nodo: 16023
   3. Total de Verificadores en el nodo: 01

➡️Bloque (1) 9am: 0
➡️Bloque (2) 2pm: 0
➡️Bloque (3) 6pm:1`
  },
  {
    remitente: "Maria Mallerlin López",
    hora: "17:30",
    texto: `*Formato de reporte salida a campo*
   *1. Municipio:* Maturín 
   *2. Nodo:* 16073
   
*Total Verificadores en el nodo:* 02 

➡️*Bloque (1) 9am:* 
➡️*Bloque (2) 2pm:* 
➡️*Bloque (3) 6pm:* 2`
  },
  {
    remitente: "Salvy",
    hora: "17:30",
    texto: `*Formato de reporte salida a campo*
   Nodo : 16102
 *Municipio:* Bolívar 
   
*Total Verificadores en el municipio:* 2

 ➡️*Bloque (1) 9am:*  
 ➡️*Bloque (2) 2pm:*  
 ➡️*Bloque (3) 6pm:* 1`
  },
  {
    remitente: "Rosa Carrillo",
    hora: "17:35",
    texto: `Formato de reporte salida a campo
   1. Municipio:  Piar
   2. Nodo: 16009
   3. Total de Verificadores en el nodo:4

➡️Bloque (1) 9am: 
➡️Bloque (2) 2pm:
➡️Bloque (3) 6pm: 04

Nota`
  },
  {
    remitente: "Yuris Sanchez",
    hora: "17:37",
    texto: `Formato de reporte y salida a campo
   1. Municipio: Maturin 
   2. Nodo: 16017
   3. Total de Verificadores en el nodo: 03

➡️Bloque (1) 9am: 0
➡️Bloque (2) 2pm: 0
➡️Bloque (3) 6pm: 3`
  },
  {
    remitente: "Ronnys Montilla",
    hora: "17:54",
    texto: `*Formato de reporte salida a campo*
   *1. Municipio:* Maturin
   *2. Nodo:* 16061
   
*Total Verificadores en el nodo:* 03

➡️*Bloque (1) 9am:* 
➡️*Bloque (2) 2pm:* 
➡️*Bloque (3) 6pm:*03`
  }
];

msgs.forEach((m, idx) => {
  const parsed = parsearReporte(m.texto);
  console.log(`[${idx + 1}] ${m.remitente} (${m.hora}):`, parsed);
});
