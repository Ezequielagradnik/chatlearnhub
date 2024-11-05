import { Server } from "socket.io";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import {pool} from './dbconfig.js';